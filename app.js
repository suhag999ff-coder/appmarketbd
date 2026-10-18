/* app.js — Professional Storefront */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CART_KEY = "av_cart_v1";
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='52%' font-family='sans-serif' font-size='16' fill='#4f46e5' text-anchor='middle' font-weight='700'>AppVerse</text></svg>`);
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = { user: null, products: [], categories: [], settings: {}, search: "", cat: "" };

const money = (n) => (Number(n) || 0) > 0 ? "৳" + Number(n).toLocaleString("en-BD") : "Free";
const safeUrl = (u) => { try { const url = new URL(u); return (url.protocol === "http:" || url.protocol === "https:") ? url.href : ""; } catch { return ""; } };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, type = "info", title) {
  const stack = $("#toasts"); if (!stack) return;
  const icons = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i><div><strong>${title || ''}</strong> ${esc(msg)}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3500);
}

/* CART */
function readCart() { try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { return []; } }
function writeCart(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartBadge(); }
function addToCart(p) {
  const cart = readCart(); const ex = cart.find(i => i.id === p.id);
  if (ex) ex.qty += 1; else cart.push({ id: p.id, name: p.name, price: Number(p.price) || 0, imageUrl: p.imageUrl, qty: 1 });
  writeCart(cart); toast("Added to cart", "success");
}
function updateCartBadge() {
  const n = readCart().reduce((s, i) => s + i.qty, 0);
  [$("#cartCount"), $("#cartCountMobile")].forEach(el => { if (el) { el.textContent = n; el.hidden = n === 0; } });
}

/* MODALS */
function openM(id) { const m = document.getElementById(id); if (m) { m.hidden = false; document.body.style.overflow = "hidden"; } }
function closeM(id) { const m = document.getElementById(id); if (m) { m.hidden = true; document.body.style.overflow = ""; } }
document.addEventListener("click", (e) => { const c = e.target.closest("[data-close]"); if (c) closeM(c.dataset.close); });

/* RENDER PRODUCTS */
function productCard(p) {
  const price = Number(p.price) || 0;
  const card = document.createElement("article"); card.className = "product-card";
  card.innerHTML = `
    <div class="product-media">
      <img src="${safeUrl(p.imageUrl) || PH}" loading="lazy">
      ${p.featured ? '<span class="product-badge">FEATURED</span>' : ""}
    </div>
    <div class="product-body">
      <span class="product-cat">${esc(p.categoryName || "App")}</span>
      <h3 class="product-name">${esc(p.name)}</h3>
      <div class="product-price">${money(price)} ${p.originalPrice > price ? `<span class="price-old">${money(p.originalPrice)}</span>` : ''}</div>
      <button class="btn-buy" data-view="${p.id}"><i class="fa-solid fa-cart-shopping"></i> Buy Now</button>
    </div>`;
  return card;
}

function renderGrid(items) {
  const g = $("#allGrid"); g.innerHTML = "";
  if (!items.length) { g.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">No apps found</div>`; return; }
  items.forEach(p => g.appendChild(productCard(p)));
}

function filterProducts() {
  let items = state.products;
  if (state.cat) items = items.filter(p => p.categoryId === state.cat);
  if (state.search) items = items.filter(p => p.name.toLowerCase().includes(state.search.toLowerCase()));
  renderGrid(items);
}

/* PRODUCT DETAIL MODAL (PROFESSIONAL) */
document.addEventListener("click", async (e) => {
  const viewBtn = e.target.closest("[data-view]");
  if (viewBtn) {
    const p = state.products.find(x => x.id === viewBtn.dataset.view);
    if (!p) return;
    
    const body = $("#productDetail");
    const screenshots = (p.screenshotUrls || []).map(url => `<img src="${safeUrl(url) || PH}">`).join("");
    
    body.innerHTML = `
      <div class="app-detail-header">
        <img src="${safeUrl(p.imageUrl) || PH}" class="app-detail-logo">
        <div>
          <h2 class="app-detail-title">${esc(p.name)}</h2>
          <span class="product-cat">${esc(p.categoryName)}</span>
          <div class="app-detail-price">${money(p.price)}</div>
        </div>
      </div>
      
      <div style="display:flex; gap:12px; margin-bottom:24px">
        <button class="btn btn-primary btn-lg" id="btnBuyNow" style="flex:1"><i class="fa-solid fa-bolt"></i> Buy Now</button>
        <button class="btn btn-ghost btn-lg" id="btnAddCart" style="flex:1"><i class="fa-solid fa-cart-plus"></i> Cart</button>
      </div>

      <h4 style="font-size:1.1rem; margin-bottom:10px">Description</h4>
      <p style="color:var(--muted); font-size:0.95rem; line-height:1.6; margin-bottom:24px">${esc(p.description || "No description provided.")}</p>

      ${screenshots ? `<h4 style="font-size:1.1rem; margin-bottom:10px">Screenshots</h4><div class="screenshots-scroll">${screenshots}</div>` : ""}
    `;
    openM("productModal");

    // Buy Now (Direct Checkout)
    $("#btnBuyNow").onclick = () => {
      localStorage.setItem(CART_KEY, JSON.stringify([{ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, qty: 1 }]));
      updateCartBadge();
      closeM("productModal");
      if (!state.user) { location.href = "login.html?next=index.html"; return; }
      renderOrderSummary(); renderPaymentInstructions($("#ofMethod").value); openM("orderModal");
    };

    $("#btnAddCart").onclick = () => { addToCart(p); closeM("productModal"); };
  }
});

/* PAYMENT & CHECKOUT */
function renderPaymentInstructions(method) {
  const box = $("#paymentInstructions"); const s = state.settings;
  let num = "", label = "";
  if (method === "bkash") { num = s.bkashNumber; label = "bKash"; }
  else if (method === "nagad") { num = s.nagadNumber; label = "Nagad"; }
  else if (method === "rocket") { num = s.rocketNumber; label = "Rocket"; }
  
  if (method !== "cash" && num) {
    box.innerHTML = `<div style="background:var(--primary-l); padding:16px; border-radius:12px; text-align:center; margin-bottom:16px">
      <p style="font-size:0.9rem; margin-bottom:8px">Send money to this ${label} number:</p>
      <strong style="font-size:1.2rem; color:var(--primary)">${num}</strong>
    </div>`;
    $("#txnField").hidden = false;
  } else {
    box.innerHTML = `<div class="alert alert-warn">Cash payment: Our team will contact you.</div>`;
    $("#txnField").hidden = true;
  }
}

function renderOrderSummary() {
  const cart = readCart(); const host = $("#orderSummary");
  let total = 0;
  const rows = cart.map(i => { total += i.price * i.qty; return `<div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:8px"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`; }).join("");
  host.innerHTML = `<div style="background:var(--surface-2); padding:16px; border-radius:12px;">${rows}<div style="display:flex;justify-content:space-between;font-weight:800;border-top:1px solid var(--border);padding-top:12px;margin-top:12px"><span>Total</span><span>${money(total)}</span></div></div>`;
}

/* SUBMIT ORDER & TELEGRAM NOTIFICATION */
$("#orderForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cart = readCart(); if (!cart.length) return toast("Cart is empty", "error");
  if (!state.user) return toast("Please login first", "error");

  const name = $("#ofName").value.trim(), contact = $("#ofContact").value.trim(), method = $("#ofMethod").value, txn = $("#ofTxn").value.trim();
  if (!name || !contact) return toast("Name and Phone required", "error");

  const btn = $("#submitOrderBtn"); btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;

  try {
    let total = 0; cart.forEach(i => total += i.price * i.qty);
    
    // Save to Firestore
    await addDoc(collection(db, "orders"), {
      userId: state.user.uid, customerName: name, contactNumber: contact,
      paymentMethod: method, transactionReference: txn || null, 
      items: cart.map(i => ({ productId: i.id, name: i.name, price: i.price, qty: i.qty })),
      total, status: "pending", createdAt: serverTimestamp()
    });

    // 🔔 TELEGRAM NOTIFICATION
    const token = state.settings.telegramToken, chatId = state.settings.telegramChatId;
    if (token && chatId) {
      const text = `🛒 <b>New Order Received!</b>\n\n` +
                   `<b>Customer:</b> ${name}\n` +
                   `<b>Phone:</b> ${contact}\n` +
                   `<b>Payment:</b> ${method.toUpperCase()} (${txn || "N/A"})\n` +
                   `<b>Total:</b> ${money(total)}\n\n` +
                   `<b>Items:</b>\n` + cart.map(i => `• ${i.name} × ${i.qty}`).join("\n");
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
      }).catch(err => console.log("Telegram Error:", err));
    }

    localStorage.removeItem(CART_KEY); updateCartBadge(); closeM("orderModal");
    toast("Order placed successfully!", "success");
    setTimeout(() => location.href = "orders.html", 1000);
  } catch (err) {
    toast(err.message, "error");
  } finally { btn.disabled = false; btn.innerHTML = `Submit Order`; }
});

/* INIT APP */
async function init() {
  // Load Settings
  const sSnap = await getDoc(doc(db, "settings", "public"));
  if (sSnap.exists()) state.settings = sSnap.data();

  // Load Categories
  const cSnap = await getDocs(collection(db, "categories"));
  const cats = cSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active !== false);
  const chipWrap = $("#categoryChips");
  chipWrap.innerHTML = `<button class="chip active" data-cat="">All</button>` + cats.map(c => `<button class="chip" data-cat="${c.id}">${esc(c.name)}</button>`).join("");
  
  // Load Products
  const pSnap = await getDocs(collection(db, "products"));
  state.products = pSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.available === true);
  filterProducts();

  // Listeners
  chipWrap.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    $$(".chip").forEach(c => c.classList.remove("active")); b.classList.add("active");
    state.cat = b.dataset.cat; filterProducts();
  });

  $("#navSearch")?.addEventListener("input", (e) => { state.search = e.target.value; filterProducts(); });
  $("#ofMethod")?.addEventListener("change", (e) => renderPaymentInstructions(e.target.value));
  $("#checkoutBtn")?.addEventListener("click", () => {
    if (!state.user) return location.href = "login.html";
    closeM("cartDrawer"); renderOrderSummary(); renderPaymentInstructions("bkash"); openM("orderModal");
    if(state.user.displayName) $("#ofName").value = state.user.displayName;
  });

  updateCartBadge();
  onAuthStateChanged(auth, u => { state.user = u || null; });
}
init();
