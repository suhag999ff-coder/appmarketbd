/* library.js — User's purchased apps library */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const $ = (s) => document.querySelector(s);
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='55%' font-family='sans-serif' font-size='10' fill='#4f46e5' text-anchor='middle' font-weight='700'>AV</text></svg>`);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try { const x = new URL(u); return ["http:","https:"].includes(x.protocol) ? x.href : ""; }
  catch { return ""; }
};

function toast(msg, type = "info") {
  const stack = $("#toasts"); if (!stack) return;
  const icons = { info:"fa-circle-info", success:"fa-circle-check", error:"fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i><div class="toast-body">${esc(msg)}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 260); }, 4000);
}

const fns = getFunctions();
const getDownloadUrl = httpsCallable(fns, "getDownloadUrl");

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "login.html?next=library.html"; return; }
  const list  = $("#libraryList");
  const empty = $("#libraryEmpty");
  list.innerHTML = `<div class="skeleton" style="height:110px;border-radius:16px;margin-bottom:12px"></div>
                    <div class="skeleton" style="height:110px;border-radius:16px"></div>`;

  try {
    const q1 = query(
      collection(db, "orders"),
      where("userId", "==", user.uid),
      where("status", "in", ["delivered", "completed"]),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q1);
    list.innerHTML = "";

    // Flatten items
    const owned = new Map(); // productId -> { name, imageUrl, orderId, qty }
    snap.forEach(d => {
      const o = d.data();
      (o.items || []).forEach(i => {
        if (i.productId && !owned.has(i.productId)) {
          owned.set(i.productId, {
            id: i.productId, name: i.name, imageUrl: i.imageUrl,
            orderId: d.id, qty: i.qty
          });
        }
      });
    });

    if (!owned.size) {
      list.hidden = true; empty.hidden = false; return;
    }

    // Enrich with product info
    const enriched = await Promise.all(
      [...owned.values()].map(async it => {
        try {
          const p = await getDoc(doc(db, "products", it.id));
          return { ...it, ...(p.exists() ? p.data() : {}) };
        } catch { return it; }
      })
    );

    enriched.forEach(app => {
      const card = document.createElement("div");
      card.className = "order-card";
      card.style.display = "flex";
      card.style.gap = "14px";
      card.style.alignItems = "center";
      card.innerHTML = `
        <img src="${safeUrl(app.imageUrl)||PH}" onerror="this.src='${PH}'"
             style="width:64px;height:64px;border-radius:12px;object-fit:cover;background:var(--surface-2)">
        <div style="flex:1;min-width:0">
          <strong style="display:block;font-size:0.95rem">${esc(app.name)}</strong>
          <div class="muted small" style="margin-top:2px">Order #${esc(app.orderId.slice(0,10))}</div>
        </div>
        <button class="btn btn-primary btn-sm" data-dl="${app.id}">
          <i class="fa-solid fa-download"></i> Download
        </button>`;
      list.appendChild(card);
    });

    // Download handler
    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-dl]");
      if (!btn) return;
      const productId = btn.dataset.dl;
      const orig = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
      try {
        const res = await getDownloadUrl({ productId });
        const url = res.data?.url;
        if (!url) throw new Error("No URL returned");
        window.open(url, "_blank", "noopener");
        toast("Opening download…", "success");
      } catch (err) {
        console.error(err);
        toast(err.message || "Download failed", "error");
      } finally {
        btn.disabled = false; btn.innerHTML = orig;
      }
    });

  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="alert alert-danger">Failed to load library.</div>`;
  }
});
