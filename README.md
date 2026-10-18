# AppVerse — Firebase Marketplace

Mobile-first digital app marketplace with admin panel. Telegram alerts configured **from the admin panel** — no `.env` files, no CLI secrets.

## Prerequisites

- Node.js 18+
- Firebase project (already configured: `app-market-place-1859a`)
- Firebase CLI (`npm install -g firebase-tools`)
- **Blaze plan** on Firebase (required for Cloud Functions)

## Setup — 5 Steps (Do in order)

### 1. Enable Firebase Auth + Firestore
- Firebase Console → Authentication → Email/Password → **Enable**
- Firestore Database → **Create database** → Production mode

### 2. Deploy Firestore rules
```bash
firebase login
firebase use app-market-place-1859a
firebase deploy --only firestore:rules,firestore:indexes
