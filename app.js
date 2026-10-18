/* app.js — Professional Storefront */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CART_KEY = "av_cart_v1";
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='52%' font-family='sans-serif' font-size='16' fill='#4f46e5' text-anchor='middle' font-weight='700'>AppVerse</text></svg>`);
const $ = (s) => document.querySelector(s);

const state = { user: null, products: [], categories: [], settings: {}, search: "", cat: "" };
const money = (n) => (Number(n) || 0) > 0 ? "৳" + Number(n).toLocaleString("en-BD") : "Free";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, type = "info") {
  const stack = $("#toasts"); if (!stack) return;
  const el = document.createElement("div"); el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${type==='success'?'fa-circle-check':'fa-circle-info'}"></i> <div>${esc(msg)}</div>`;
  stack.appendChild(el); setTimeout(() => el.remove(), 3500);
}

function openM(id) { $(`#${id}`).hidden = false; document.body.style.overflow = "hidden"; }
function closeM(id) { $(`#${id}`).hidden = true; document.body.style.overflow = ""; }
document.addEventListener("click", (e) => { const c = e.target.closest("[data-close]"); if (c) closeM(c.dataset.close); });

/* CART */
function readCart() { try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { return []; } }
function writeCart(c) { localStorage.setItem(CART_KEY, JSON.stringify(c)); updateCartBadge(); }
function updateCartBadge() {
  const n = readCart().reduce((s, i) => s + i.qty, 0);
  [$("#cartCount"), $("#cartCountMobile")].forEach(el => { if (el) { el.textContent = n; el.hidden = n === 0; } });
}

/* RENDER PRODUCTS */
function productCard(p) {
  const card = document.createElement("article"); card.className = "product-card";
  card.innerHTML = `
    <div class="product-media">
      <img src="${p.imageUrl || PH}" loading="lazy">
      ${p.featured ? '<span class="product-badge">FEATURED</span>' : ""}
    </div>
    <div class="product-body">
      <span class="product-cat">${esc(p.categoryName || "App")}</span>
      <h3 class="product-name">${esc(p.name)}</h3>
      <div class="product-price">${money(p.price)} ${p.originalPrice > p.price ? `<span style="font-size:0.8rem; color:var(--muted); text-decoration:line-through; font-weight:500;">${money(p.originalPrice)}</span>` : ''}</div>
      <button class="btn-buy" data-view="${p.id}"><i class="fa-solid fa-cart-shopping"></i> Buy Now</button>
    </div>`;
  return card;
}

function renderGrid(items) {
  const g = $("#allGrid"); g.innerHTML = "";
  if (!items.length) { g.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted);grid-column:1/-1;">No apps found</div>`; return; }
  items.forEach(p => g.appendChild(productCard(p)));
}

/* PRODUCT DETAIL MODAL */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (btn) {
    const p = state.products.find(x => x.id === btn.dataset.view);
    if (!p) return;
    const screenshots = (p.screenshotUrls || []).map(url => `<img src="${url}">`).join("");
    
    $("#productDetail").innerHTML = `
      <div class="app-detail-header">
        <img src="${p.imageUrl || PH}" class="app-detail-logo">
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
      <h4 style="margin-bottom:8px;">Description</h4>
      <p style="color:var(--muted); font-size:0.95rem; margin-bottom:20px; line-height:1.6;">${esc(p.description || "No description.")}</p>
      ${screenshots ? `<h4 style="margin-bottom:8px;">Screenshots</h4><div class="screenshots-scroll">${screenshots}</div>` : ""}
    `;
    openM("productModal");

    $("#btnBuyNow").onclick = () => {
      localStorage.setItem(CART_KEY, JSON.stringify([{ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, qty: 1 }]));
      updateCartBadge(); closeM("productModal");
      if (!state.user) return location.href = "login.html";
      renderOrderSummary(); openM("orderModal");
    };
    $("#btnAddCart").onclick = () => {
      const cart = readCart(); const ex = cart.find(i => i.id === p.id);
      if (ex) ex.qty++; else cart.push({ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, qty: 1 });
      writeCart(cart); toast("Added to cart", "success"); closeM("productModal");
    };
  }
});

/* CHECKOUT & TELEGRAM */
function renderOrderSummary() {
  const cart = readCart(); let total = 0;
  const rows = cart.map(i => { total += i.price * i.qty; return `<div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:8px"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`; }).join("");
  $("#orderSummary").innerHTML = `<div style="background:var(--surface-2); padding:16px; border-radius:12px;">${rows}<div style="display:flex;justify-content:space-between;font-weight:800;border-top:1px solid var(--border);padding-top:12px;margin-top:12px"><span>Total</span><span>${money(total)}</span></div></div>`;
}

$("#orderForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cart = readCart(); if (!cart.length) return;
  const name = $("#ofName").value, contact = $("#ofContact").value, method = $("#ofMethod").value, txn = $("#ofTxn").value;
  const btn = e.submitter; btn.disabled = true; btn.innerHTML = "Processing...";

  try {
    let total = 0; cart.forEach(i => total += i.price * i.qty);
    await addDoc(collection(db, "orders"), {
      userId: state.user.uid, customerName: name, contactNumber: contact, paymentMethod: method, transactionReference: txn,
      items: cart.map(i => ({ productId: i.id, name: i.name, price: i.price, qty: i.qty })),
      total, status: "pending", createdAt: serverTimestamp()
    });

    // Telegram Alert
    const { telegramToken, telegramChatId } = state.settings;
    if (telegramToken && telegramChatId) {
      fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChatId, text: `🛒 <b>New Order!</b>\n\n<b>Name:</b> ${name}\n<b>Total:</b> ${money(total)}`, parse_mode: 'HTML' })
      }).catch(console.log);
    }

    localStorage.removeItem(CART_KEY); updateCartBadge(); closeM("orderModal");
    toast("Order placed successfully!", "success");
    setTimeout(() => location.href = "orders.html", 1000);
  } catch (err) { toast("Failed to order", "error"); btn.disabled = false; }
});

/* INIT */
async function init() {
  const sSnap = await getDoc(doc(db, "settings", "public"));
  if (sSnap.exists()) state.settings = sSnap.data();

  const cSnap = await getDocs(collection(db, "categories"));
  state.categories = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  $("#categoryChips").innerHTML = `<button class="chip active" data-cat="">All</button>` + state.categories.map(c => `<button class="chip" data-cat="${c.id}">${esc(c.name)}</button>`).join("");

  const pSnap = await getDocs(collection(db, "products"));
  state.products = pSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.available !== false);
  
  renderGrid(state.products);

  $("#categoryChips").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active")); b.classList.add("active");
    state.cat = b.dataset.cat;
    renderGrid(state.cat ? state.products.filter(p => p.categoryId === state.cat) : state.products);
  };

  $("#navSearch")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderGrid(state.products.filter(p => p.name.toLowerCase().includes(q)));
  });

  updateCartBadge();
  onAuthStateChanged(auth, u => { state.user = u; });
}
init();
