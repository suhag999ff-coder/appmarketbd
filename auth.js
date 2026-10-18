/* auth.js — Login, Register, Account page */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const toast = (msg, type="info") => {
  const stack = $("#toasts"); if(!stack) return alert(msg);
  const el = document.createElement("div"); el.className = `toast ${type}`; el.innerHTML = `<div>${msg}</div>`;
  stack.appendChild(el); setTimeout(() => el.remove(), 3000);
};

function friendlyAuthError(code) {
  const map = { "auth/invalid-email": "Invalid email", "auth/user-not-found": "No account found", "auth/wrong-password": "Incorrect password", "auth/email-already-in-use": "Email already registered", "auth/weak-password": "Password must be 6+ characters" };
  return map[code] || "Something went wrong";
}

/* LOGIN */
$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#submitBtn"); btn.disabled = true; btn.innerHTML = "Signing in...";
  try {
    await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#password").value);
    const next = new URLSearchParams(location.search).get("next") || "index.html";
    location.href = next;
  } catch (err) { toast(friendlyAuthError(err.code), "error"); btn.disabled = false; btn.innerHTML = "Sign in"; }
});

$("#forgotBtn")?.addEventListener("click", async (e) => {
  e.preventDefault(); const email = prompt("Enter your email:");
  if (!email) return;
  try { await sendPasswordResetEmail(auth, email); toast("Reset email sent!", "success"); } catch (err) { toast(friendlyAuthError(err.code), "error"); }
});

/* REGISTER & TELEGRAM ALERT */
$("#registerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#name").value.trim(), email = $("#email").value.trim(), password = $("#password").value;
  if (password.length < 6) return toast("Password too short", "error");

  const btn = $("#submitBtn"); btn.disabled = true; btn.innerHTML = "Creating...";
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), { uid: cred.user.uid, displayName: name, email, createdAt: serverTimestamp() });

    // 🔔 TELEGRAM NEW USER ALERT
    try {
      const sSnap = await getDoc(doc(db, "settings", "public"));
      if (sSnap.exists()) {
        const s = sSnap.data();
        if (s.telegramToken && s.telegramChatId) {
          const text = `👤 <b>New User Registered!</b>\n\n<b>Name:</b> ${name}\n<b>Email:</b> ${email}`;
          fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: s.telegramChatId, text: text, parse_mode: 'HTML' })
          }).catch(err => console.log("TG Error:", err));
        }
      }
    } catch (e) { console.log("Telegram failed", e); }

    toast("Account created successfully!", "success");
    setTimeout(() => location.href = "index.html", 1000);
  } catch (err) { toast(friendlyAuthError(err.code), "error"); btn.disabled = false; btn.innerHTML = "Create account"; }
});

/* ACCOUNT PAGE */
if ($("#accountPage")) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return location.href = "login.html?next=account.html";
    $("#accName").textContent = user.displayName || "User"; $("#accEmail").textContent = user.email;
    $("#accInitial").textContent = (user.displayName || "U").charAt(0).toUpperCase();
    
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) { const d = snap.data(); $("#editName").value = d.displayName || ""; $("#editPhone").value = d.phone || ""; $("#editAddress").value = d.address || ""; }

    $("#profileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault(); const btn = e.submitter; btn.disabled = true; btn.innerHTML = "Saving...";
      try {
        await updateProfile(user, { displayName: $("#editName").value.trim() });
        await setDoc(doc(db, "users", user.uid), { displayName: $("#editName").value.trim(), phone: $("#editPhone").value.trim(), address: $("#editAddress").value.trim(), updatedAt: serverTimestamp() }, { merge: true });
        toast("Profile updated!", "success");
      } catch (err) { toast(err.message, "error"); } finally { btn.disabled = false; btn.innerHTML = "Save changes"; }
    });

    $("#logoutBtn")?.addEventListener("click", async (e) => { e.preventDefault(); await signOut(auth); location.href = "index.html"; });
  });
}
