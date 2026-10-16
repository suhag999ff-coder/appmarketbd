import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDXmm3bmoK6vwv76JBC9mpdVvQw6SwQDNQ",
  authDomain: "app-market-place-1859a.firebaseapp.com",
  databaseURL: "https://app-market-place-1859a-default-rtdb.firebaseio.com",
  projectId: "app-market-place-1859a",
  storageBucket: "app-market-place-1859a.firebasestorage.app",
  messagingSenderId: "389007057910",
  appId: "1:389007057910:web:7a136019e70669c4721dd7"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);