# AppVerse — Firebase Marketplace

Mobile-first app marketplace with admin panel. Deploy on Vercel + Firebase.

## Setup Steps (in order)

### 1. Firebase Console
- Open https://console.firebase.google.com → project **app-market-place-1859a**
- Authentication → Sign-in method → Enable **Email/Password**
- Firestore Database → Create database → **Production mode**

### 2. Install CLI & deploy rules
```bash
npm install -g firebase-tools
firebase login
firebase use app-market-place-1859a
firebase deploy --only firestore:rules,firestore:indexes