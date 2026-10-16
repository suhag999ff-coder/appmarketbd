# AppVerse — Professional Firebase Marketplace

A production-oriented digital app marketplace: storefront + admin dashboard,
Firebase Auth + Cloud Firestore + Cloud Functions, deployable to Vercel.

## Architecture

- **Storefront**: `index.html`, `product.html`, `login.html`, `register.html`,
  `account.html`, `orders.html`
- **Admin panel**: `/admin/*.html` — protected by Firebase Auth + `admins/{uid}`
- **Cloud Functions** (`functions/index.js`):
  - `createOrder` — authoritative price calculation + Telegram notification
  - `updateOrderStatus` — admin-only + Telegram notification
  - `grantAdmin` — provision additional admins
  - `onNewUser` — Telegram notification on signup
- **Security rules**: `firestore.rules` — deny-by-default

## 1) Firebase Setup

1. Open [Firebase Console](https://console.firebase.google.com/) → project **app-market-place-1859a**.
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Firestore Database** → Create database → production mode → region close to you.
4. Enable **Cloud Functions** (requires Blaze plan).

## 2) Create the first administrator

You cannot create admin accounts from the UI. Do it once, manually:

1. **Register a normal account** through `/register.html` using the email you will use as admin.
2. Open Firebase Console → **Firestore** → create collection **`admins`**.
3. Add a document whose **Document ID is your Auth UID** (find it in Authentication → Users).
4. Set fields: `enabled` (boolean, true), `createdAt` (timestamp, now).
5. Sign in at `/admin/login.html` with that email.

Then you can add more admins either by duplicating this step, or by calling the
`grantAdmin` Cloud Function once `OWNER_UID` is configured.

## 3) Configure the Telegram bot

The bot token must **never** be placed in any frontend file. Store it as a Firebase secret:

```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
# paste: 8835851288:AAGEq031gK-oSonbAi_iqEvcqUgE5cFBhes

firebase functions:secrets:set TELEGRAM_CHAT_ID
# paste: -1004322135682