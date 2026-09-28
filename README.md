# FIADO — bridge WhatsApp (Baileys)

Petit serveur qui connecte un compte WhatsApp classique (comme WhatsApp
Web) et expose `POST /send` pour que `send-reminders` de FIADO envoie
des relances sans passer par l'API officielle Meta — donc sans compte
developpeur, sans carte bancaire, sans templates a faire approuver.

**A savoir avant de deployer** : cette librairie n'est pas officielle et
viole les conditions d'utilisation de WhatsApp. Envoyer des relances
automatiques quotidiennes a des numeros differents chaque jour est
exactement le pattern que WhatsApp detecte et peut bannir — si ca
arrive, le numero connecte perd l'acces a WhatsApp entierement. Utilise
un numero dedie si possible, jamais ton numero personnel principal.

## 1. Installer

```bash
npm install
cp .env.example .env
```

Remplis `BRIDGE_TOKEN` dans `.env` avec une longue chaine au hasard —
c'est ce qui protege `/send` contre un usage non autorise.

## 2. Se connecter a WhatsApp (une seule fois)

```bash
npm run dev
```

Un QR code s'affiche dans le terminal. Scanne-le depuis le telephone
qui doit envoyer les relances : WhatsApp > Parametres > Appareils
lies > Lier un appareil.

La session est sauvegardee dans `auth_info/` — tant que ce dossier
persiste, pas besoin de rescanner au redemarrage.

## 3. Deployer en continu

Ce serveur doit rester allume 24h/24 (pas de serverless) — un petit VPS
(Contabo, Hostinger, ~5$/mois) ou equivalent :

```bash
npm run build
npm start
```

Pour survivre a un redemarrage/crash, utilise `pm2` ou un service
`systemd` qui relance automatiquement `npm start`. **Important** :
`auth_info/` doit etre sur un disque persistant, pas un volume ephemere
— sinon il faut rescanner le QR a chaque redeploiement.

## 4. Brancher a FIADO

Cote Supabase (voir `supabase/functions/send-reminders` dans le repo
FIADO) :

```bash
supabase secrets set WHATSAPP_BRIDGE_URL=https://ton-serveur.example.com
supabase secrets set WHATSAPP_BRIDGE_TOKEN=<le meme BRIDGE_TOKEN>
```

## API

`GET /health` → `{ ok, connected, queued }`

`POST /send` (header `Authorization: Bearer <BRIDGE_TOKEN>`), body :
```json
{ "phone": "+22670000000", "message": "Texte libre du message" }
```
Reponse `202` immediate (le message est mis en file) — l'envoi reel est
espace de `SEND_DELAY_MS` (8s par defaut) pour reduire le risque de
bannissement. Augmente cette valeur si le volume de relances grandit.
