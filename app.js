/* app.js — Storefront (secure, no client Telegram, theme-aware) */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, doc, getDoc,
  addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CART_KEY = "av_cart_v1";
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='52%' font-family='sans-serif' font-size='16' fill='#4f46e5' text-anchor='middle' font-weight='700'>AppVerse</text></svg>`);

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  user: null, products: [], categories: [],
  settings: {}, search: "", cat: "", sort: "newest"
};

/* ─── Helpers ─── */
const money = (n) => (Number(n) || 0) > 0 ? "৳" + Number(n).toLocaleString("en-BD") : "Free";
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try { const url = new URL(u); return ["http:","https:"].includes(url.protocol) ? url.href : ""; }
  catch { return ""; }
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

function toast(msg, type = "info", title) {
  const stack = $("#toasts"); if (!stack) return;
  const icons = { info:"fa-circle-info", success:"fa-circle-check", error:"fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i>
    <div class="toast-body">${title ? `<strong>${esc(title)}</strong>` : ""}${esc(msg)}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 260); }, 4000);
}

/* ─── Cart ─── */
function readCart() {
  try { const a = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(a) ? a.filter(i => i && i.id && i.qty > 0) : []; }
  catch { return []; }
}
function writeCart(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartBadge(); }
function addToCart(p, qty = 1) {
  const cart = readCart();
  const ex = cart.find(i => i.id === p.id);
  if (ex) ex.qty = Math.min(ex.qty + qty, 20);
  else cart.push({ id: p.id, name: p.name, price: Number(p.price)||0, imageUrl: p.imageUrl, qty });
  writeCart(cart); toast("Added to cart", "success", p.name);
}
function updateCartBadge() {
  const n = readCart().reduce((s,i) => s + i.qty, 0);
  [$("#cartCount"), $("#cartCountMobile")].forEach(el => {
    if (el) { el.textContent = String(n); el.hidden = n === 0; }
  });
}
function changeQty(id, d) {
  const cart = readCart(); const it = cart.find(i => i.id === id);
  if (it) { it.qty = Math.max(1, Math.min(20, it.qty + d)); writeCart(cart); renderCart(); }
}
function removeFromCart(id) { writeCart(readCart().filter(i => i.id !== id)); renderCart(); toast("Removed", "info"); }
function renderCart() {
  const cart = readCart(); const wrap = $("#cartItems"); if (!wrap) return;
  wrap.innerHTML = cart.length ? "" : `<div class="empty-state"><i class="fa-regular fa-bag-shopping"></i><h3>Cart is empty</h3></div>`;
  cart.forEach(it => {
    const row = document.createElement("div"); row.className = "cart-item";
    row.innerHTML = `
      <img src="${safeUrl(it.imageUrl) || PH}" onerror="this.src='${PH}'">
      <div class="cart-item-info">
        <strong>${esc(it.name)}</strong><div class="price">${money(it.price)}</div>
        <div class="qty-ctrl">
          <button class="qty-btn" data-qty="${it.id}" data-d="-1"><i class="fa-solid fa-minus"></i></button>
          <span>${it.qty}</span>
          <button class="qty-btn" data-qty="${it.id}" data-d="1"><i class="fa-solid fa-plus"></i></button>
        </div>
      </div>
      <button class="cart-remove" data-rm="${it.id}"><i class="fa-solid fa-trash"></i></button>`;
    wrap.appendChild(row);
  });
  $("#cartTotal").textContent = money(cart.reduce((s,i) => s + i.price * i.qty, 0));
  $("#checkoutBtn").disabled = !cart.length;
}
document.addEventListener("click", e => {
  const q = e.target.closest("[data-qty]"); if (q) return changeQty(q.dataset.qty, Number(q.dataset.d));
  const r = e.target.closest("[data-rm]");  if (r) return removeFromCart(r.dataset.rm);
});

/* ─── Modals ─── */
function openM(id) { const m = document.getElementById(id); if (m) { m.hidden = false; document.body.style.overflow = "hidden"; } }
function closeM(id) { const m = document.getElementById(id); if (m) { m.hidden = true;
  if (!document.querySelector(".modal:not([hidden]), .drawer:not([hidden])")) document.body.style.overflow = ""; } }
document.addEventListener("click", e => { const c = e.target.closest("[data-close]"); if (c) closeM(c.dataset.close); });

/* ─── Product card ─── */
function productCard(p) {
  const price = Number(p.price) || 0;
  const priceHtml = price > 0
    ? `${money(price)}${Number(p.originalPrice) > price ? ` <span class="price-old">${money(p.originalPrice)}</span>` : ""}`
    : "Free";
  const card = document.createElement("article"); card.className = "product-card";
  card.innerHTML = `
    <div class="product-media">
      <img src="${safeUrl(p.imageUrl) || PH}" onerror="this.src='${PH}'" loading="lazy">
      ${p.featured ? '<span class="product-badge">FEATURED</span>' : ""}
    </div>
    <div class="product-body">
      ${p.categoryName ? `<span class="product-cat">${esc(p.categoryName)}</span>` : ""}
      <h3 class="product-name">${esc(p.name)}</h3>
      <div class="product-price"><span class="${price > 0 ? "price-now" : "price-free"}">${priceHtml}</span></div>
      <div class="product-cta">
        <a class="btn-view" href="product.html?id=${encodeURIComponent(p.id)}"><i class="fa-regular fa-eye"></i> View</a>
        <button class="btn-add" data-add="${p.id}"><i class="fa-solid fa-plus"></i> Add</button>
      </div>
    </div>`;
  return card;
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-add]");
  if (a) { const p = state.products.find(x => x.id === a.dataset.add); if (p) addToCart(p); }
});

function renderGrid(gid, eid, items) {
  const g = $("#"+gid), em = $("#"+eid); if (!g || !em) return;
  g.innerHTML = "";
  if (!items.length) { g.hidden = true; em.hidden = false; return; }
  g.hidden = false; em.hidden = true; items.forEach(p => g.appendChild(productCard(p)));
}
function renderAll() {
  renderGrid("featuredGrid", "featuredEmpty", state.products.filter(p => p.featured).slice(0, 6));
  renderGrid("latestGrid",   "latestEmpty",   state.products.slice(0, 6));
  renderBrowse();
}
function renderBrowse() {
  const sk = $("#allSkeleton"); if (sk) sk.hidden = true;
  let items = state.products.slice();
  if (state.cat) items = items.filter(p => p.categoryId === state.cat);
  const q = state.search.trim().toLowerCase();
  if (q) items = items.filter(p =>
    (p.name||"").toLowerCase().includes(q) ||
    (p.categoryName||"").toLowerCase().includes(q) ||
    (p.developer||"").toLowerCase().includes(q) ||
    (Array.isArray(p.tags) && p.tags.some(t => String(t).toLowerCase().includes(q)))
  );
  if (state.sort === "price-asc") items.sort((a,b) => (a.price||0) - (b.price||0));
  else if (state.sort === "price-desc") items.sort((a,b) => (b.price||0) - (a.price||0));
  else if (state.sort === "name") items.sort((a,b) => (a.name||"").localeCompare(b.name||""));
  else items.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  const g = $("#allGrid"), em = $("#allEmpty");
  g.innerHTML = "";
  if (!items.length) { g.hidden = true; em.hidden = false; }
  else { g.hidden = false; em.hidden = true; items.forEach(p => g.appendChild(productCard(p))); }
  $("#resultCount").textContent = `${items.length} apps`;
}

/* ─── Categories ─── */
function renderChips() {
  const wrap = $("#categoryChips"); if (!wrap) return;
  wrap.innerHTML = `<button class="chip${state.cat === "" ? " active" : ""}" data-cat="">All</button>`;
  state.categories.forEach(c => {
    const b = document.createElement("button");
    b.className = "chip" + (state.cat === c.id ? " active" : "");
    b.dataset.cat = c.id; b.textContent = c.name;
    wrap.appendChild(b);
  });
}
document.addEventListener("click", e => {
  const c = e.target.closest("[data-cat]");
  if (c) { state.cat = c.dataset.cat || ""; renderChips(); renderBrowse(); }
});

/* ─── Data loaders ─── */
async function loadProducts() {
  let snap = null;
  try {
    snap = await getDocs(query(collection(db,"products"), where("available","==",true),
      orderBy("createdAt","desc"), limit(200)));
  } catch {
    snap = await getDocs(query(collection(db,"products"), limit(300)));
  }
  state.products = snap.docs.map(d => ({id:d.id, ...d.data()}))
    .filter(p => p.available === true)
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  renderAll();
}
async function loadCategories() {
  try {
    const snap = await getDocs(collection(db,"categories"));
    state.categories = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .filter(c => c.active !== false)
      .sort((a,b) => (a.name||"").localeCompare(b.name||""));
    renderChips();
  } catch (e) { console.warn(e); }
}
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db,"settings","public"));
    if (snap.exists()) state.settings = snap.data();
    const phone = state.settings.contactPhone || "8801700000000";
    const email = state.settings.contactEmail || "support@appverse.com";
    const wa = $("#chatWhatsapp"), call = $("#chatCall"), mail = $("#chatEmail");
    if (wa)   wa.href   = `https://wa.me/${phone.replace(/[^0-9]/g,'')}`;
    if (call) call.href = `tel:${phone}`;
    if (mail) mail.href = `mailto:${email}`;
  } catch (e) { console.warn(e); }
}

/* ─── Payment instructions ─── */
function renderPaymentInstructions(method) {
  const box = $("#paymentInstructions"); if (!box) return;
  const s = state.settings;
  let num = "", qr = "", label = "";
  if (method === "bkash")  { num = s.bkashNumber;  qr = s.bkashQr;  label = "bKash"; }
  else if (method === "nagad") { num = s.nagadNumber; qr = s.nagadQr; label = "Nagad"; }
  else if (method === "rocket"){ num = s.rocketNumber; qr = s.rocketQr; label = "Rocket"; }
  else { box.innerHTML = `<div class="alert alert-info"><i class="fa-solid fa-circle-info"></i>
    <div>Cash payment: our team will contact you.</div></div>`; return; }

  if (!num && !qr) {
    box.innerHTML = `<div class="alert alert-warn">Payment number not set by admin.</div>`;
    return;
  }
  const safeNum = esc(num);
  box.innerHTML = `
    <div class="payment-card">
      <div class="payment-card-head">Send money to this ${esc(label)} number:</div>
      <div style="display:flex;align-items:center;gap:12px;margin:8px 0;justify-content:center">
        <strong style="font-size:1.1rem;letter-spacing:0.5px">${safeNum || "N/A"}</strong>
        <button class="btn btn-ghost btn-sm" id="copyPayBtn" type="button">
          <i class="fa-regular fa-copy"></i> Copy
        </button>
      </div>
      ${qr ? `<img src="${safeUrl(qr)}" style="width:120px;height:120px;border-radius:8px;border:1px solid var(--border);margin:8px auto 0" alt="QR">` : ""}
    </div>`;
  $("#copyPayBtn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(num).then(() => {
      const b = $("#copyPayBtn");
      b.innerHTML = `<i class="fa-solid fa-check"></i> Copied`;
      setTimeout(() => b.innerHTML = `<i class="fa-regular fa-copy"></i> Copy`, 1500);
    });
  });
}

$("#ofMethod")?.addEventListener("change", e => renderPaymentInstructions(e.target.value));

function renderOrderSummary() {
  const cart = readCart(); const host = $("#orderSummary"); if (!host) return;
  let total = 0;
  const rows = cart.map(i => {
    const line = i.price * i.qty; total += line;
    return `<div class="order-line"><span>${esc(i.name)} × ${i.qty}</span><span>${money(line)}</span></div>`;
  }).join("");
  host.innerHTML = `<div style="background:var(--surface-2);padding:12px;border-radius:12px">
    ${rows}<div class="order-total"><span>Total</span><span>${money(total)}</span></div></div>`;
}

/* ─── Submit order (Telegram now handled by Cloud Function) ─── */
async function submitOrder(e) {
  e.preventDefault();
  const cart = readCart(); if (!cart.length) return toast("Cart empty","error");
  if (!state.user) {
    toast("Sign in required","error");
    setTimeout(() => location.href = "login.html?next=index.html", 500); return;
  }
  const name    = $("#ofName").value.trim();
  const contact = $("#ofContact").value.trim();
  const method  = $("#ofMethod").value;
  const txn     = $("#ofTxn").value.trim();
  if (!name || !contact) return toast("Name & phone required","error");
  if (method !== "cash" && !txn) return toast("Transaction ID required","error");

  const btn = $("#submitOrderBtn"); const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting…`;

  try {
    let total = 0;
    cart.forEach(i => total += i.price * i.qty);
    await addDoc(collection(db,"orders"), {
      userId: state.user.uid,
      customerName: name,
      contactNumber: contact,
      paymentMethod: method,
      transactionReference: txn || null,
      items: cart.map(i => ({ productId: i.id, name: i.name, price: i.price, qty: i.qty })),
      total,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    localStorage.removeItem(CART_KEY);
    updateCartBadge();
    closeM("orderModal");
    toast("Order submitted!", "success");
    setTimeout(() => location.href = "orders.html", 800);
  } catch (err) {
    console.error(err);
    toast("Failed to place order","error");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

/* ─── Account icon ─── */
function renderAccountIcon() {
  const el = $("#accountIcon"); if (!el) return;
  el.href = state.user ? "account.html" : "login.html";
}

/* ─── Support widget ─── */
$("#supportFab")?.addEventListener("click", () => { $("#supportWidget").hidden = false; });
$("#supportClose")?.addEventListener("click", () => { $("#supportWidget").hidden = true; });

/* ─── Bind ─── */
function bind() {
  const yr = $("#year"); if (yr) yr.textContent = new Date().getFullYear();
  let st;
  const searchHandler = (e) => {
    clearTimeout(st);
    st = setTimeout(() => { state.search = e.target.value; renderBrowse(); }, 180);
  };
  $("#navSearch")?.addEventListener("input", searchHandler);
  $("#mobileSearch")?.addEventListener("input", searchHandler);
  $("#sortSelect")?.addEventListener("change", e => { state.sort = e.target.value; renderBrowse(); });
  $("#cartBtn")?.addEventListener("click", () => { renderCart(); openM("cartDrawer"); });
  $("#navCart")?.addEventListener("click", e => { e.preventDefault(); renderCart(); openM("cartDrawer"); });
  $("#navBrowse")?.addEventListener("click", e => {
    e.preventDefault(); $("#browse")?.scrollIntoView({ behavior: "smooth" });
  });

  $("#checkoutBtn")?.addEventListener("click", () => {
    if (!state.user) {
      toast("Sign in to order","info");
      setTimeout(() => location.href = "login.html?next=index.html", 500); return;
    }
    closeM("cartDrawer");
    renderOrderSummary();
    renderPaymentInstructions($("#ofMethod").value);
    if (state.user.displayName) $("#ofName").value = state.user.displayName;
    openM("orderModal");
  });
  $("#orderForm")?.addEventListener("submit", submitOrder);
}

/* ─── Init ─── */
async function init() {
  bind(); updateCartBadge();
  await loadSettings();
  loadProducts(); loadCategories();
  onAuthStateChanged(auth, u => { state.user = u || null; renderAccountIcon(); });
}
init();
