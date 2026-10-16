/* app.js — Storefront controller (mobile-first, resilient) */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, orderBy, limit, getDocs, doc, getDoc,
  addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CART_KEY = "av_cart_v1";
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='52%' font-family='sans-serif' font-size='16' fill='#4f46e5' text-anchor='middle' font-weight='700'>AppVerse</text><text x='50%' y='64%' font-family='sans-serif' font-size='10' fill='#94a3b8' text-anchor='middle'>no image</text></svg>`);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  user: null,
  products: [],
  categories: [],
  search: "",
  cat: "",
  sort: "newest"
};

/* ---------- Helpers ---------- */
const money = (n) => {
  const v = Number(n) || 0;
  return v > 0 ? "৳" + v.toLocaleString("en-BD") : "Free";
};
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try {
    const url = new URL(u);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
  } catch { return ""; }
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const tsOf = (p) => {
  const t = p?.createdAt;
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t === "number") return t;
  if (typeof t === "string") return Date.parse(t) || 0;
  return 0;
};

function toast(msg, type = "info", title) {
  const stack = $("#toasts");
  if (!stack) return;
  const icons = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i>
    <div class="toast-body">${title ? `<strong>${esc(title)}</strong>` : ""}${esc(msg)}</div>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0";
    el.style.transform = "translateY(-10px)";
    setTimeout(() => el.remove(), 260);
  }, 4000);
}

/* ---------- Cart ---------- */
function readCart() {
  try {
    const arr = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter(i => i && i.id && i.qty > 0) : [];
  } catch { return []; }
}
function writeCart(c) {
  localStorage.setItem(CART_KEY, JSON.stringify(c));
  updateCartBadge();
}
function addToCart(p, qty = 1) {
  const cart = readCart();
  const ex = cart.find(i => i.id === p.id);
  if (ex) ex.qty = Math.min(ex.qty + qty, 20);
  else cart.push({
    id: p.id,
    name: p.name || "Untitled",
    price: Number(p.price) || 0,
    imageUrl: p.imageUrl || "",
    qty: Math.min(qty, 20)
  });
  writeCart(cart);
  toast(`Added to cart`, "success", p.name);
}
function changeQty(id, delta) {
  const cart = readCart();
  const it = cart.find(i => i.id === id);
  if (!it) return;
  it.qty = Math.max(1, Math.min(20, it.qty + delta));
  writeCart(cart);
  renderCart();
}
function removeFromCart(id) {
  writeCart(readCart().filter(i => i.id !== id));
  renderCart();
  toast("Removed from cart", "info");
}
function updateCartBadge() {
  const n = readCart().reduce((s, i) => s + i.qty, 0);
  [$("#cartCount"), $("#cartCountMobile")].forEach(el => {
    if (!el) return;
    el.textContent = String(n);
    el.hidden = n === 0;
  });
}
function renderCart() {
  const cart = readCart();
  const wrap = $("#cartItems");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!cart.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-bag-shopping"></i>
      <h3>Your cart is empty</h3><p>Add apps to get started.</p></div>`;
  } else {
    cart.forEach(it => {
      const row = document.createElement("div");
      row.className = "cart-item";
      row.innerHTML = `
        <img src="${safeUrl(it.imageUrl) || PH}" alt="" loading="lazy" onerror="this.src='${PH}'">
        <div class="cart-item-info">
          <strong>${esc(it.name)}</strong>
          <div class="price">${money(it.price)}</div>
          <div class="qty-ctrl">
            <button class="qty-btn" data-qty="${it.id}" data-d="-1"><i class="fa-solid fa-minus"></i></button>
            <span>${it.qty}</span>
            <button class="qty-btn" data-qty="${it.id}" data-d="1"><i class="fa-solid fa-plus"></i></button>
          </div>
        </div>
        <button class="cart-remove" data-rm="${it.id}"><i class="fa-solid fa-trash"></i></button>`;
      wrap.appendChild(row);
    });
  }
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  $("#cartTotal").textContent = money(total);
  $("#checkoutBtn").disabled = cart.length === 0;
}
document.addEventListener("click", (e) => {
  const q = e.target.closest("[data-qty]");
  if (q) return changeQty(q.dataset.qty, Number(q.dataset.d));
  const r = e.target.closest("[data-rm]");
  if (r) return removeFromCart(r.dataset.rm);
});

/* ---------- Modals ---------- */
function openM(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeM(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.hidden = true;
  if (!document.querySelector(".modal:not([hidden]), .drawer:not([hidden])")) {
    document.body.style.overflow = "";
  }
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) closeM(c.dataset.close);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $$(".modal:not([hidden]), .drawer:not([hidden])").forEach(m => closeM(m.id));
  }
});

/* ---------- Product card ---------- */
function productCard(p) {
  const price = Number(p.price) || 0;
  const priceHtml = price > 0
    ? `${money(price)}${Number(p.originalPrice) > price ? ` <span class="price-old">${money(p.originalPrice)}</span>` : ""}`
    : "Free";
  const card = document.createElement("article");
  card.className = "product-card";
  card.innerHTML = `
    <div class="product-media">
      <img src="${safeUrl(p.imageUrl) || PH}" alt="${esc(p.name)}" loading="lazy"
           onerror="this.src='${PH}'">
      ${p.featured ? '<span class="product-badge">FEATURED</span>' : ""}
    </div>
    <div class="product-body">
      ${p.categoryName ? `<span class="product-cat">${esc(p.categoryName)}</span>` : ""}
      <h3 class="product-name">${esc(p.name || "Untitled")}</h3>
      <div class="product-price">
        <span class="${price > 0 ? "price-now" : "price-free"}">${priceHtml}</span>
      </div>
      <div class="product-cta">
        <button class="btn-view" data-view="${p.id}"><i class="fa-regular fa-eye"></i> View</button>
        <button class="btn-add" data-add="${p.id}"><i class="fa-solid fa-plus"></i> Add</button>
      </div>
    </div>`;
  return card;
}
document.addEventListener("click", (e) => {
  const v = e.target.closest("[data-view]");
  if (v) return openProduct(v.dataset.view);
  const a = e.target.closest("[data-add]");
  if (a) {
    const p = state.products.find(x => x.id === a.dataset.add);
    if (p) addToCart(p);
  }
});

/* ---------- Render grids ---------- */
function renderGrid(gridId, emptyId, items) {
  const g = $("#" + gridId);
  const em = $("#" + emptyId);
  if (!g || !em) return;
  g.innerHTML = "";
  if (!items.length) {
    g.hidden = true;
    em.hidden = false;
    return;
  }
  g.hidden = false;
  em.hidden = true;
  items.forEach(p => g.appendChild(productCard(p)));
}
function renderAll() {
  const list = state.products;
  renderGrid("featuredGrid", "featuredEmpty", list.filter(p => p.featured).slice(0, 6));
  renderGrid("latestGrid", "latestEmpty", list.slice(0, 6));
  renderBrowse();
}
function renderBrowse() {
  const sk = $("#allSkeleton");
  if (sk) sk.hidden = true;
  let items = state.products.slice();
  const q = state.search.trim().toLowerCase();
  if (state.cat) items = items.filter(p => p.categoryId === state.cat);
  if (q) {
    items = items.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      (p.categoryName || "").toLowerCase().includes(q)
    );
  }
  switch (state.sort) {
    case "price-asc": items.sort((a, b) => (a.price || 0) - (b.price || 0)); break;
    case "price-desc": items.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
    case "name": items.sort((a, b) => (a.name || "").localeCompare(b.name || "")); break;
    default: items.sort((a, b) => tsOf(b) - tsOf(a));
  }
  const g = $("#allGrid");
  const em = $("#allEmpty");
  g.innerHTML = "";
  if (!items.length) {
    g.hidden = true;
    em.hidden = false;
  } else {
    g.hidden = false;
    em.hidden = true;
    items.forEach(p => g.appendChild(productCard(p)));
  }
  const rc = $("#resultCount");
  if (rc) rc.textContent = `${items.length} of ${state.products.length} apps`;
}

/* ---------- Category chips ---------- */
function renderChips() {
  const wrap = $("#categoryChips");
  if (!wrap) return;
  wrap.innerHTML = `<button class="chip${state.cat === "" ? " active" : ""}" data-cat="">All</button>`;
  state.categories.forEach(c => {
    const b = document.createElement("button");
    b.className = "chip" + (state.cat === c.id ? " active" : "");
    b.dataset.cat = c.id;
    b.textContent = c.name;
    wrap.appendChild(b);
  });
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cat]");
  if (c) {
    state.cat = c.dataset.cat || "";
    renderChips();
    renderBrowse();
  }
});

/* ---------- Product modal ---------- */
async function openProduct(id) {
  const body = $("#productDetail");
  body.innerHTML = `<div class="skeleton" style="height:280px"></div>`;
  openM("productModal");
  try {
    const snap = await getDoc(doc(db, "products", id));
    if (!snap.exists()) throw new Error("Not found");
    const p = { id: snap.id, ...snap.data() };
    renderProduct(p, body);
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>Could not load this product.</div></div>`;
  }
}
function renderProduct(p, host) {
  const price = Number(p.price) || 0;
  const shots = Array.isArray(p.screenshotUrls) ? p.screenshotUrls.filter(safeUrl) : [];
  const thumbs = shots.map((s, i) => `
    <img src="${s}" data-shot="${s}" class="${i === 0 ? "active" : ""}"
         onerror="this.style.display='none'">`).join("");

  host.innerHTML = `
    <div class="product-detail">
      <img class="main" id="pmMain" src="${safeUrl(p.imageUrl) || PH}"
           alt="${esc(p.name)}" onerror="this.src='${PH}'">
      ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ""}
      ${p.categoryName ? `<span class="product-cat">${esc(p.categoryName)}</span>` : ""}
      <h2>${esc(p.name || "Untitled")}</h2>
      <div style="display:flex;align-items:baseline;gap:10px;margin:8px 0">
        <span class="${price > 0 ? "price-now" : "price-free"}" style="font-size:1.5rem">
          ${money(price)}
        </span>
        ${Number(p.originalPrice) > price ? `<span class="price-old">${money(p.originalPrice)}</span>` : ""}
      </div>
      ${p.version ? `<div class="detail-row"><span>Version</span><span>${esc(p.version)}</span></div>` : ""}
      ${p.categoryName ? `<div class="detail-row"><span>Category</span><span>${esc(p.categoryName)}</span></div>` : ""}
      <div class="detail-row"><span>Availability</span><span>${p.available === false ? "Unavailable" : "Available"}</span></div>
      ${p.description ? `<p class="detail-desc">${esc(p.description)}</p>` : ""}
      <div class="modal-actions">
        <button class="btn btn-primary btn-block" id="pmAdd" ${p.available === false ? "disabled" : ""}>
          <i class="fa-solid fa-cart-plus"></i> Add to cart
        </button>
      </div>
    </div>`;

  host.querySelectorAll("[data-shot]").forEach(t => {
    t.addEventListener("click", () => {
      host.querySelectorAll(".thumbs img").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("#pmMain").src = t.dataset.shot;
    });
  });
  const addBtn = $("#pmAdd");
  if (addBtn) addBtn.addEventListener("click", () => {
    addToCart(p);
    closeM("productModal");
  });
}

/* ---------- Data loading (resilient) ---------- */
async function loadProducts() {
  let snap = null;
  try {
    snap = await getDocs(query(
      collection(db, "products"),
      where("available", "==", true),
      orderBy("createdAt", "desc"),
      limit(200)
    ));
  } catch (err) {
    console.warn("Index missing, using fallback:", err?.code);
    try {
      snap = await getDocs(query(collection(db, "products"), limit(300)));
    } catch (e) {
      toast("Could not load products.", "error");
      $("#allSkeleton").hidden = true;
      return;
    }
  }
  state.products = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.available === true)
    .sort((a, b) => tsOf(b) - tsOf(a));
  renderAll();
}

async function loadCategories() {
  try {
    const snap = await getDocs(collection(db, "categories"));
    state.categories = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.active !== false)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderChips();
  } catch (err) { console.warn("cats fail", err); }
}

/* ---------- Order flow ---------- */
function renderOrderSummary() {
  const cart = readCart();
  const host = $("#orderSummary");
  if (!host) return;
  let total = 0;
  const rows = cart.map(i => {
    const line = i.price * i.qty;
    total += line;
    return `<div class="order-line"><span>${esc(i.name)} × ${i.qty}</span><span>${money(line)}</span></div>`;
  }).join("");
  host.innerHTML = `
    <div style="background:var(--surface-2);padding:12px;border-radius:12px">
      ${rows}
      <div class="order-total"><span>Total</span><span>${money(total)}</span></div>
    </div>`;
}

async function submitOrder(e) {
  e.preventDefault();
  const cart = readCart();
  if (!cart.length) return toast("Cart is empty", "error");

  const name = $("#ofName").value.trim();
  const contact = $("#ofContact").value.trim();
  const method = $("#ofMethod").value;
  const txn = $("#ofTxn").value.trim();
  const note = $("#ofNote").value.trim();

  $$(".error[data-err]").forEach(n => n.textContent = "");
  let ok = true;
  if (name.length < 2) { $('[data-err="ofName"]').textContent = "Name required"; ok = false; }
  if (contact.length < 6) { $('[data-err="ofContact"]').textContent = "Valid phone required"; ok = false; }
  if (method !== "cash" && txn.length < 3) { $('[data-err="ofTxn"]').textContent = "Transaction ID required"; ok = false; }
  if (!ok) return;

  if (!state.user) {
    toast("Please sign in first", "error");
    setTimeout(() => location.href = "login.html?next=index.html", 500);
    return;
  }

  const btn = $("#submitOrderBtn");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting…`;

  try {
    // Recompute total server-side in rules we validate loosely; final total reviewed by admin
    let total = 0;
    cart.forEach(i => total += i.price * i.qty);

    const ref = await addDoc(collection(db, "orders"), {
      userId: state.user.uid,
      customerName: name,
      contactNumber: contact,
      paymentMethod: method,
      transactionReference: txn || null,
      note: note || null,
      items: cart.map(i => ({ productId: i.id, name: i.name, price: i.price, qty: i.qty })),
      total,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    localStorage.removeItem(CART_KEY);
    updateCartBadge();
    closeM("orderModal");
    toast(`Order #${ref.id.slice(0, 8)} submitted!`, "success", "Success");
    setTimeout(() => location.href = "orders.html", 900);
  } catch (err) {
    console.error(err);
    toast(err.message || "Failed to submit order", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ---------- Auth UI ---------- */
function renderAccountIcon() {
  const el = $("#accountIcon");
  if (!el) return;
  if (state.user) {
    el.href = "account.html";
    el.innerHTML = `<i class="fa-solid fa-user"></i>`;
    el.title = state.user.email || "";
  } else {
    el.href = "login.html";
    el.innerHTML = `<i class="fa-solid fa-user"></i>`;
  }
}

/* ---------- Bind ---------- */
function bind() {
  $("#year").textContent = String(new Date().getFullYear());

  // Search
  let st;
  const applySearch = (v) => {
    state.search = v || "";
    renderBrowse();
  };
  $("#navSearch")?.addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(() => applySearch(e.target.value), 180);
  });
  $("#mobileSearch")?.addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(() => applySearch(e.target.value), 180);
  });

  // Sort
  $("#sortSelect")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderBrowse();
  });

  // Cart open
  const openCart = () => { renderCart(); openM("cartDrawer"); };
  $("#cartBtn")?.addEventListener("click", openCart);
  $("#navCart")?.addEventListener("click", (e) => { e.preventDefault(); openCart(); });
  $("#navBrowse")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("browse").scrollIntoView({ behavior: "smooth" });
  });

  // Checkout
  $("#checkoutBtn")?.addEventListener("click", () => {
    if (!state.user) {
      toast("Please sign in to order", "info");
      setTimeout(() => location.href = "login.html?next=index.html", 500);
      return;
    }
    closeM("cartDrawer");
    renderOrderSummary();
    if (state.user.displayName) $("#ofName").value = state.user.displayName;
    openM("orderModal");
  });

  $("#orderForm")?.addEventListener("submit", submitOrder);

  // Payment method change
  $("#ofMethod")?.addEventListener("change", (e) => {
    $("#txnField").hidden = e.target.value === "cash";
  });
}

/* ---------- Init ---------- */
function init() {
  bind();
  updateCartBadge();
  loadProducts();
  loadCategories();
  onAuthStateChanged(auth, (u) => {
    state.user = u || null;
    renderAccountIcon();
  });
}
init();