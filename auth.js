/* auth.js — User Auth & Account */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const toast = (msg, type) => alert(msg); // Simplified for alert

/* LOGIN */
$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault(); const btn = $("#submitBtn"); btn.disabled = true;
  try { await signInWithEmailAndPassword(auth, $("#email").value, $("#password").value); location.href = "index.html"; }
  catch (err) { alert(err.message); btn.disabled = false; }
});

/* REGISTER */
$("#registerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault(); const btn = $("#submitBtn"); btn.disabled = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, $("#email").value, $("#password").value);
    await updateProfile(cred.user, { displayName: $("#name").value });
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid, displayName: $("#name").value, email: $("#email").value, 
      balance: 0, // Default Balance
      createdAt: serverTimestamp() 
    });
    location.href = "index.html";
  } catch (err) { alert(err.message); btn.disabled = false; }
});

/* ACCOUNT PAGE */
if ($("#accountPage")) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return location.href = "login.html";
    
    // Load User Info
    const snap = await getDoc(doc(db, "users", user.uid));
    const d = snap.exists() ? snap.data() : {};
    
    $("#accName").textContent = d.displayName || "User";
    $("#accEmail").textContent = d.email || user.email;
    $("#accBalance").textContent = "৳" + (d.balance || 0);
    $("#editName").value = d.displayName || "";
    $("#editPhone").value = d.phone || "";
    $("#editAddress").value = d.address || "";

    // Save Profile
    $("#profileForm").onsubmit = async (e) => {
      e.preventDefault();
      await setDoc(doc(db, "users", user.uid), {
        displayName: $("#editName").value, phone: $("#editPhone").value, address: $("#editAddress").value
      }, { merge: true });
      alert("Profile Updated!");
    };

    $("#logoutBtn").onclick = () => signOut(auth).then(() => location.href = "index.html");
  });
}
