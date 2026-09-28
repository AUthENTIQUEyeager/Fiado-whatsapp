import "dotenv/config";
import express from "express";
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";

// -- Config ----------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
const AUTH_DIR = process.env.AUTH_DIR ?? "./auth_info";
// Delai entre deux envois : reduit (sans l'annuler) le risque de
// bannissement du numero — voir README.md. Ne pas descendre en dessous
// de quelques secondes.
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS ?? 8000);

if (!BRIDGE_TOKEN) {
  console.error("BRIDGE_TOKEN manquant dans .env — obligatoire pour proteger /send.");
  process.exit(1);
}

const logger = pino({ level: "silent" }); // Baileys est tres verbeux par defaut

// -- File d'attente ----------------------------------------------------------
//
// /send ne parle jamais directement au socket WhatsApp : le message est
// mis en file, et un seul worker la vide, un message toutes les
// SEND_DELAY_MS. Ca decouple aussi /send de la lenteur voulue de l'envoi —
// l'appelant (l'Edge Function send-reminders de FIADO, qui a un temps
// d'execution limite) n'attend jamais l'espacement, juste la mise en file.

interface QueuedMessage {
  phone: string;
  message: string;
}

const queue: QueuedMessage[] = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      await sendNow(item.phone, item.message);
      console.log(`Envoye a ${item.phone}`);
    } catch (err) {
      console.error(`Echec envoi a ${item.phone} :`, (err as Error).message);
    }
    if (queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    }
  }
  processing = false;
}

// -- Connexion WhatsApp (Baileys) --------------------------------------------

let sock: ReturnType<typeof makeWASocket> | undefined;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({ auth: state, logger });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScanne ce QR code avec WhatsApp > Appareils lies :\n");
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      if (loggedOut) {
        console.log("Deconnecte par WhatsApp — supprime le dossier auth_info et relance pour rescanner.");
      } else {
        console.log("Connexion fermee, reconnexion...");
        void startSock();
      }
    } else if (connection === "open") {
      console.log("Connecte a WhatsApp.");
    }
  });
}

function toJid(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return `${digits}@s.whatsapp.net`;
}

async function sendNow(phone: string, message: string): Promise<void> {
  if (!sock) throw new Error("Pas encore connecte a WhatsApp");
  await sock.sendMessage(toJid(phone), { text: message });
}

// -- API HTTP ----------------------------------------------------------------

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, connected: Boolean(sock?.user), queued: queue.length });
});

app.post("/send", (req, res) => {
  if (req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) {
    res.status(401).json({ ok: false, error: "Non autorise" });
    return;
  }

  const { phone, message } = (req.body ?? {}) as { phone?: unknown; message?: unknown };
  if (typeof phone !== "string" || !phone || typeof message !== "string" || !message) {
    res.status(400).json({ ok: false, error: "phone et message requis" });
    return;
  }

  queue.push({ phone, message });
  void processQueue();

  // 202 : le message est en file, pas encore livre — voulu, pour ne
  // jamais faire attendre l'appelant le temps de l'espacement des envois.
  res.status(202).json({ ok: true, queued: queue.length });
});

app.listen(PORT, () => {
  console.log(`Bridge WhatsApp sur le port ${PORT}`);
});

void startSock();
