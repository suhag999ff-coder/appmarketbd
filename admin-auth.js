/* admin-auth.js — verifies the signed-in user is an enabled admin via admins/{uid}. */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const $ = (s) => document.querySelector(s);
const ADMIN_HOME = "index.html";

function toast(msg, type = "info", title) {
  const stack = $("#toasts"); if (!stack) return;
  const icons = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation" };
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${icons[type]}"></i><div class="toast-body">${title ? `<strong>${title}</strong>` : ""}${msg.replace(/</g, "&lt;")}</div>`;
  stack.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 250); }, 4200);
}

async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists() && snap.data().enabled === true;
  } catch (err) {
    console.error("[admin-auth] isAdmin failed:", err);
    return false;
  }
}

/* Login page controller */
const form = $("#adminLoginForm");
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    document.querySelectorAll(".error[data-error-for]").forEach(n => n.textContent = "");
    if (!email) { document.querySelector('[data-error-for="email"]').textContent = "Email required."; return; }
    if (!password) { document.querySelector('[data-error-for="password"]').textContent = "Password required."; return; }

    const btn = $("#adminLoginBtn"); const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying…`;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const ok = await isAdmin(cred.user.uid);
      if (!ok) {
        await signOut(auth);
        $("#denied").hidden = false;
        throw new Error("Your account is not authorized as an administrator.");
      }
      window.location.replace(ADMIN_HOME);
    } catch (err) {
      const code = err?.code || "";
      let msg = err?.message || "Sign in failed.";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
        msg = "Invalid email or password.";
      if (code === "auth/too-many-requests") msg = "Too many attempts. Try again later.";
      toast(msg, "error", "Sign in failed");
      btn.disabled = false; btn.innerHTML = orig;
    }
  });
}

/* Guard every other admin page */
const isLoginPage = !!form;
if (!isLoginPage) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    const ok = await isAdmin(user.uid);
    if (!ok) {
      await signOut(auth);
      window.location.replace("login.html?denied=1");
      return;
    }
    const host = document.getElementById("adminUser");
    if (host) {
      host.innerHTML = "";
      host.append(
        Object.assign(document.createElement("div"), { textContent: user.email || "" }),
        Object.assign(document.createElement("div"), { className: "muted small", textContent: "Signed in as administrator" })
      );
    }
    const logout = document.getElementById("adminLogout");
    if (logout) logout.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      window.location.replace("login.html");
    });
  });
}