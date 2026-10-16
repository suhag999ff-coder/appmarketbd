// firebase-config.js
// Firebase modular SDK initialization for AppVerse marketplace.
// NOTE: Web config is public by design; security is enforced via Firestore Rules
// and Cloud Functions. Never place Admin SDK keys here.

import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyDXmm3bmoK6vwv76JBC9mpdVvQw6SwQDNQ",
  authDomain: "app-market-place-1859a.firebaseapp.com",
  databaseURL: "https://app-market-place-1859a-default-rtdb.firebaseio.com",
  projectId: "app-market-place-1859a",
  storageBucket: "app-market-place-1859a.firebasestorage.app",
  messagingSenderId: "389007057910",
  appId: "1:389007057910:web:7a136019e70669c4721dd7",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");

// Persist sessions across page navigations (recommended for multi-page apps).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  // Non-fatal — fall back to in-memory persistence.
  console.warn("[auth] persistence setup failed:", err?.code || err);
});