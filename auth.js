/* auth.js — Login, Register, Account page */
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendPasswordResetEmail, onAuthStateChanged,
  signOut, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function toast(msg, type = "info", title) {
  const stack = $("#toasts");
  if (!stack) return alert(msg);
  const icons = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i>
    <div class="toast-body">${title ? `<strong>${title}</strong>` : ""}${msg}</div>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-10px)";
    setTimeout(() => el.remove(), 260);
  }, 4000);
}

function showErr(msg) {
  const box = $("#errBox"); const m = $("#errMsg");
  if (box && m) { box.hidden = false; m.textContent = msg; }
  else toast(msg, "error");
}

function friendlyAuthError(code) {
  const map = {
    "auth/invalid-email": "Invalid email address.",
    "auth/user-not-found": "No account with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
    "auth/network-request-failed": "Network error. Check your connection."
  };
  return map[code] || "Something went wrong. Please try again.";
}

/* ============ LOGIN ============ */
const loginForm = $("#loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (!email || !password) return showErr("Email and password required");

    const btn = $("#submitBtn");
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing in…`;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      const next = new URLSearchParams(location.search).get("next") || "index.html";
      toast("Signed in!", "success");
      setTimeout(() => location.href = next, 400);
    } catch (err) {
      showErr(friendlyAuthError(err.code));
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  $("#forgotBtn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = prompt("Enter your email:");
    if (!email) return;
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Reset email sent. Check your inbox.", "success");
    } catch (err) {
      toast(friendlyAuthError(err.code), "error");
    }
  });
}

/* ============ REGISTER ============ */
const registerForm = $("#registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#name").value.trim();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (name.length < 2) return showErr("Please enter your full name");
    if (password.length < 6) return showErr("Password too short");

    const btn = $("#submitBtn");
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating…`;

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });

      // Create users/{uid} profile
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        displayName: name,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      toast("Account created!", "success");
      setTimeout(() => location.href = "index.html", 500);
    } catch (err) {
      showErr(friendlyAuthError(err.code));
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
}

/* ============ ACCOUNT PAGE ============ */
const accountPage = $("#accountPage");
if (accountPage) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "login.html?next=account.html";
      return;
    }
    // Fill profile
    const nameEl = $("#accName");
    const emailEl = $("#accEmail");
    const initialEl = $("#accInitial");
    if (nameEl) nameEl.textContent = user.displayName || "User";
    if (emailEl) emailEl.textContent = user.email || "";
    if (initialEl) initialEl.textContent = (user.displayName || user.email || "U").charAt(0).toUpperCase();

    // Load extra profile data
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        if ($("#editName")) $("#editName").value = d.displayName || user.displayName || "";
        if ($("#editPhone")) $("#editPhone").value = d.phone || "";
        if ($("#editAddress")) $("#editAddress").value = d.address || "";
      }
    } catch (err) { console.warn(err); }

    // Save profile
    $("#profileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const displayName = $("#editName").value.trim();
      const phone = $("#editPhone").value.trim();
      const address = $("#editAddress").value.trim();
      const btn = e.submitter || $("#profileForm button[type=submit]");
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
      try {
        await updateProfile(user, { displayName });
        await setDoc(doc(db, "users", user.uid), {
          displayName, phone, address,
          email: user.email,
          uid: user.uid,
          updatedAt: serverTimestamp()
        }, { merge: true });
        toast("Profile updated", "success");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });

    // Logout
    $("#logoutBtn")?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm("Sign out?")) return;
      await signOut(auth);
      location.href = "index.html";
    });
  });
}