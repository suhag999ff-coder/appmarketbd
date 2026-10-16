/* =========================================================
   app.js — Storefront controller
   Resilient product loading: tries optimized query, falls
   back gracefully when a Firestore composite index is missing.
   ========================================================= */

import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection, query, where, orderBy, limit, getDocs, doc, getDoc
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

/* ------------------ Constants ------------------ */
const CART_KEY = "appverse.cart.v1";
const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 250'>
     <rect width='100%' height='100%' fill='#eef2ff'/>
     <text x='50%' y='52%' font-family='Inter,sans-serif' font-size='18' fill='#4f46e5' text-anchor='middle'>AppVerse</text>
     <text x='50%' y='62%' font-family='Inter,sans-serif' font-size='12' fill='#8b93a7' text-anchor='middle'>image unavailable</text>
   </svg>`);

/* ------------------ State ------------------ */
const state = {
  user: null,
  products: [],
  categories: [],
  search: "",
  categoryId: "",
  sort: "newest",
  unsubscribeAuth: null,
  productsUsingFallback: false,
};

/* ------------------ DOM helpers ------------------ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
};
const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "Free";
  return "৳" + v.toLocaleString("en-BD");
};
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try {
    const url = new URL(u, window.location.origin);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "";
  } catch { return ""; }
};
const imgOrPlaceholder = (u) => safeUrl(u) || PLACEHOLDER;

/* ------------------ Toasts ------------------ */
export function toast(message, type = "info", title) {
  const stack = $("#toasts");
  if (!stack) return;
  const iconMap = { success: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info" };
  const node = el("div", { class: `toast ${type}` }, [
    el("i", { class: `fa-solid ${iconMap[type] || iconMap.info}` }),
    el("div", { class: "toast-body" }, [
      title ? el("strong", { text: title }) : null,
      document.createTextNode(message)
    ])
  ]);
  stack.appendChild(node);
  setTimeout(() => {
    node.style.transition = "opacity 240ms, transform 240ms";
    node.style.opacity = "0";
    node.style.transform = "translateX(20px)";
    setTimeout(() => node.remove(), 260);
  }, 4200);
}

/* ------------------ Cart ------------------ */
function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(i => i && i.id && i.qty > 0) : [];
  } catch { return []; }
}
function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartUi();
}
function addToCart(product, qty = 1) {
  const cart = readCart();
  const existing = cart.find(i => i.id === product.id);
  if (existing) existing.qty = Math.min(existing.qty + qty, 20);
  else cart.push({
    id: product.id, name: product.name, price: Number(product.price) || 0,
    imageUrl: product.imageUrl || "", qty: Math.min(qty, 20),
  });
  writeCart(cart);
  toast(`"${product.name}" added to cart.`, "success", "Added");
}
function updateCartUi() {
  const cart = readCart();
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const badge = $("#cartCount");
  if (badge) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  const wrap = $("#cartItems");
  if (wrap) {
    wrap.replaceChildren();
    if (!cart.length) {
      wrap.appendChild(el("div", { class: "empty-state" }, [
        el("i", { class: "fa-regular fa-bag-shopping" }),
        el("h3", { text: "Your cart is empty" }),
        el("p", { text: "Add apps from the marketplace to begin." })
      ]));
    } else {
      cart.forEach(item => {
        const img = el("img", { src: imgOrPlaceholder(item.imageUrl), alt: "", loading: "lazy",
          onerror: (e) => { e.currentTarget.src = PLACEHOLDER; } });
        const row = el("div", { class: "cart-item" }, [
          img,
          el("div", { class: "cart-item-info" }, [
            el("strong", { text: item.name }),
            el("div", { class: "price", text: money(item.price) }),
            el("div", { class: "qty-ctrl" }, [
              el("button", { class: "qty-btn", type: "button", "aria-label": "Decrease",
                onclick: () => changeQty(item.id, -1) }, [el("i", { class: "fa-solid fa-minus" })]),
              el("span", { text: String(item.qty) }),
              el("button", { class: "qty-btn", type: "button", "aria-label": "Increase",
                onclick: () => changeQty(item.id, +1) }, [el("i", { class: "fa-solid fa-plus" })])
            ])
          ]),
          el("button", { class: "cart-remove", type: "button", "aria-label": "Remove",
            onclick: () => removeFromCart(item.id) }, [el("i", { class: "fa-solid fa-trash" })])
        ]);
        wrap.appendChild(row);
      });
    }
  }

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const totalEl = $("#cartTotal");
  if (totalEl) totalEl.textContent = money(total || 0);
  const checkout = $("#checkoutBtn");
  if (checkout) checkout.disabled = cart.length === 0;
}
function changeQty(id, delta) {
  const cart = readCart();
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.max(1, Math.min(20, item.qty + delta));
  writeCart(cart);
}
function removeFromCart(id) {
  writeCart(readCart().filter(i => i.id !== id));
  toast("Item removed from cart.", "info");
}

/* ------------------ Product fetch (RESILIENT) ------------------ */
async function loadCategories() {
  try {
    const snap = await getDocs(query(collection(db, "categories"), where("active", "==", true)));
    state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    renderCategoryChips();
    renderCategorySelect();
    const stat = $("#statCategories");
    if (stat) stat.textContent = String(state.categories.length);
  } catch (err) {
    console.warn("[app] categories load failed:", err?.code || err);
    // Non-fatal — the storefront works without categories.
  }
}

/**
 * Loads products. Tries the optimized compound query first.
 * If the required Firestore composite index is missing,
 * falls back to a simple collection scan and filters/sorts client-side.
 * This prevents the storefront from breaking while the index builds.
 */
async function loadProducts() {
  let snap = null;
  let usedFallback = false;

  // ---- Attempt 1: optimized compound query ----
  try {
    snap = await getDocs(query(
      collection(db, "products"),
      where("available", "==", true),
      orderBy("createdAt", "desc"),
      limit(200)
    ));
  } catch (err) {
    const isIndexError =
      err?.code === "failed-precondition" ||
      /requires an index|composite index/i.test(err?.message || "");
    if (isIndexError) {
      usedFallback = true;
      console.warn("[app] Firestore composite index missing. Falling back to simple query.");
      console.info(
        "%c[app] Create the required index from this link:",
        "color:#4f46e5;font-weight:700",
        err?.message
      );
    } else {
      // Genuine error — surface it and stop.
      console.error("[app] products load failed:", err);
      toast("Could not load products. Please try again.", "error", "Loading failed");
      hideSkeletons();
      const empty = $("#allEmpty");
      if (empty) empty.hidden = false;
      return;
    }
  }

  // ---- Attempt 2: fallback simple query ----
  if (!snap) {
    try {
      snap = await getDocs(query(collection(db, "products"), limit(500)));
    } catch (err) {
      console.error("[app] fallback query failed:", err);
      toast("Could not load products. Please try again.", "error", "Loading failed");
      hideSkeletons();
      const empty = $("#allEmpty");
      if (empty) empty.hidden = false;
      return;
    }
  }

  state.productsUsingFallback = usedFallback;

  try {
    state.products = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      // In fallback mode we must filter + sort client-side.
      .filter(p => p.available === true)
      .sort((a, b) => tsOf(b) - tsOf(a));

    const stat = $("#statProducts");
    if (stat) stat.textContent = String(state.products.length);

    if (usedFallback) {
      toast(
        "Products loaded, but a performance index is missing. Ask the site owner to create it.",
        "info",
        "Using fallback mode"
      );
    }

    renderAll();
  } catch (err) {
    console.error("[app] render failed:", err);
    hideSkeletons();
  }
}

/* ------------------ Rendering ------------------ */
function hideSkeletons() {
  const s = $("#allSkeleton");
  if (s) s.hidden = true;
}

function productCard(p) {
  const img = el("img", {
    src: imgOrPlaceholder(p.imageUrl),
    alt: p.name || "Product image",
    loading: "lazy",
    onerror: (e) => { e.currentTarget.src = PLACEHOLDER; }
  });
  const media = el("div", { class: "product-media" }, [img]);
  if (p.featured) media.appendChild(el("span", { class: "badge badge-featured", text: "Featured" }));
  if (p.available === false) media.appendChild(el("span", { class: "badge badge-out", text: "Unavailable" }));

  const priceRow = el("div", { class: "product-price" });
  const price = Number(p.price) || 0;
  if (price > 0) {
    priceRow.appendChild(el("span", { class: "price-now", text: money(price) }));
    if (Number(p.originalPrice) > price) {
      priceRow.appendChild(el("span", { class: "price-old", text: money(p.originalPrice) }));
    }
  } else {
    priceRow.appendChild(el("span", { class: "price-free", text: "Free" }));
  }

  const rating = Number(p.rating) || 0;
  const ratingRow = el("div", { class: "product-rating" }, [
    el("i", { class: "fa-solid fa-star" }),
    el("span", { text: rating > 0 ? rating.toFixed(1) : "No rating" })
  ]);

  const card = el("article", { class: "product-card" }, [
    media,
    el("div", { class: "product-body" }, [
      p.categoryName ? el("span", { class: "product-cat", text: p.categoryName }) : null,
      el("h3", { class: "product-name", text: p.name || "Untitled" }),
      ratingRow,
      priceRow,
      el("div", { class: "product-actions" }, [
        el("button", { class: "btn btn-ghost btn-sm", type: "button",
          onclick: () => openProduct(p.id) }, [
          el("i", { class: "fa-solid fa-circle-info" }), " Details"
        ]),
        el("button", { class: "btn btn-primary btn-sm", type: "button",
          onclick: () => addToCart(p) }, [
          el("i", { class: "fa-solid fa-cart-plus" }), " Add"
        ])
      ])
    ])
  ]);
  return card;
}

function renderInto(gridId, emptyId, items) {
  const grid = $("#" + gridId);
  const empty = $("#" + emptyId);
  if (!grid || !empty) return;
  grid.replaceChildren();
  if (!items.length) {
    grid.hidden = true; empty.hidden = false;
    return;
  }
  grid.hidden = false; empty.hidden = true;
  items.forEach(p => grid.appendChild(productCard(p)));
}

function renderAll() {
  const list = state.products;

  renderInto("featuredGrid", "featuredEmpty", list.filter(p => p.featured === true).slice(0, 8));

  const rated = list.filter(p => Number(p.rating) > 0)
    .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
  renderInto("popularGrid", "popularEmpty", rated.slice(0, 8));

  renderInto("latestGrid", "latestEmpty", list.slice(0, 8));

  renderAllGrid();
}

function renderAllGrid() {
  hideSkeletons();
  const q = state.search.trim().toLowerCase();
  let items = state.products.slice();

  if (state.categoryId) items = items.filter(p => p.categoryId === state.categoryId);
  if (q) {
    items = items.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      (p.categoryName || "").toLowerCase().includes(q)
    );
  }

  switch (state.sort) {
    case "oldest":
      items.sort((a, b) => tsOf(a) - tsOf(b)); break;
    case "price-asc":
      items.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0)); break;
    case "price-desc":
      items.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0)); break;
    case "name":
      items.sort((a, b) => (a.name || "").localeCompare(b.name || "")); break;
    default:
      items.sort((a, b) => tsOf(b) - tsOf(a));
  }

  const grid = $("#allGrid");
  const empty = $("#allEmpty");
  grid.replaceChildren();
  if (!items.length) {
    grid.hidden = true;
    empty.hidden = false;
  } else {
    grid.hidden = false;
    empty.hidden = true;
    items.forEach(p => grid.appendChild(productCard(p)));
  }
  const count = $("#resultsCount");
  if (count) count.textContent = `${items.length} of ${state.products.length} applications`;
}

function tsOf(p) {
  const t = p?.createdAt;
  if (!t) return 0;
  if (typeof t?.toMillis === "function") return t.toMillis();
  if (typeof t === "number") return t;
  if (typeof t === "string") { const d = Date.parse(t); return isNaN(d) ? 0 : d; }
  return 0;
}

/* ------------------ Category chips ------------------ */
function renderCategoryChips() {
  const wrap = $("#categoryChips");
  if (!wrap) return;
  wrap.replaceChildren();
  const mkChip = (label, value) => el("button", {
    class: "chip" + (state.categoryId === value ? " is-active" : ""),
    type: "button", "role": "tab",
    "aria-selected": state.categoryId === value ? "true" : "false",
    onclick: () => {
      state.categoryId = value;
      renderCategoryChips();
      renderCategorySelect();
      renderAllGrid();
    }
  }, [label]);
  wrap.appendChild(mkChip("All", ""));
  state.categories.forEach(c => wrap.appendChild(mkChip(c.name, c.id)));
}
function renderCategorySelect() {
  const sel = $("#filterCategory");
  if (!sel) return;
  sel.replaceChildren(el("option", { value: "", text: "All categories" }));
  state.categories.forEach(c => sel.appendChild(el("option", { value: c.id, text: c.name })));
  sel.value = state.categoryId || "";
}

/* ------------------ Product modal ------------------ */
async function openProduct(id) {
  const modal = $("#productModal");
  const body  = $("#productDetail");
  body.replaceChildren(el("div", { class: "stack" }, [
    el("div", { class: "skeleton-card", style: "height:320px" })
  ]));
  modal.hidden = false;
  document.body.style.overflow = "hidden";

  try {
    const snap = await getDoc(doc(db, "products", id));
    if (!snap.exists()) throw new Error("Product not found");
    const p = { id: snap.id, ...snap.data() };
    renderProductDetail(p, body);
  } catch (err) {
    console.error(err);
    body.replaceChildren(el("div", { class: "alert alert-danger" }, [
      el("i", { class: "fa-solid fa-triangle-exclamation" }),
      el("div", { text: "We could not load this product. It may have been removed." })
    ]));
  }
}

function renderProductDetail(p, host) {
  const mainImg = el("img", { src: imgOrPlaceholder(p.imageUrl), alt: p.name || "",
    onerror: (e) => { e.currentTarget.src = PLACEHOLDER; } });
  const main = el("div", { class: "main" }, [mainImg]);

  const shots = Array.isArray(p.screenshotUrls) ? p.screenshotUrls.filter(safeUrl) : [];
  const thumbs = el("div", { class: "thumbs" }, []);
  if (shots.length) {
    shots.forEach((s, idx) => {
      const t = el("img", { src: s, alt: `Screenshot ${idx + 1}`, loading: "lazy",
        class: idx === 0 ? "is-active" : "",
        onerror: (e) => { e.currentTarget.src = PLACEHOLDER; },
        onclick: () => {
          mainImg.src = s;
          $$(".thumbs img", thumbs).forEach(x => x.classList.remove("is-active"));
          t.classList.add("is-active");
        }
      });
      thumbs.appendChild(t);
    });
  }

  const price = Number(p.price) || 0;
  const priceRow = el("div", { class: "price-row" });
  if (price > 0) {
    priceRow.appendChild(el("span", { class: "price-now", text: money(price) }));
    if (Number(p.originalPrice) > price) {
      priceRow.appendChild(el("span", { class: "price-old", text: money(p.originalPrice) }));
    }
  } else {
    priceRow.appendChild(el("span", { class: "price-free", text: "Free" }));
  }

  const meta = el("div", { class: "detail-meta" });
  const addRow = (label, value) => {
    if (!value) return;
    meta.appendChild(el("div", { class: "row" }, [
      el("span", { text: label }),
      el("span", { text: value })
    ]));
  };
  addRow("Category", p.categoryName);
  addRow("Version", p.version);
  addRow("Availability", p.available === false ? "Unavailable" : "Available");

  const actions = el("div", { class: "row" }, [
    el("button", { class: "btn btn-primary", type: "button",
      disabled: p.available === false,
      onclick: () => { addToCart(p); closeModal("productModal"); } }, [
      el("i", { class: "fa-solid fa-cart-plus" }), " Add to cart"
    ]),
    safeUrl(p.productUrl) ? el("a", {
      class: "btn btn-ghost", href: safeUrl(p.productUrl), target: "_blank", rel: "noopener noreferrer"
    }, [el("i", { class: "fa-solid fa-arrow-up-right-from-square" }), " Product page"]) : null
  ]);

  host.replaceChildren(
    el("div", { class: "gallery" }, [main, shots.length ? thumbs : null]),
    el("div", {}, [
      p.categoryName ? el("span", { class: "product-cat", text: p.categoryName }) : null,
      el("h2", { id: "pmName", text: p.name || "Untitled" }),
      priceRow,
      meta,
      p.description ? el("p", { class: "detail-desc", text: p.description }) : null,
      actions
    ])
  );
}

/* ------------------ Modals ------------------ */
export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.hidden = false;
  document.body.style.overflow = "hidden";
}
export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.hidden = true;
  if (!$$(".modal:not([hidden]), .drawer:not([hidden])").length) {
    document.body.style.overflow = "";
  }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-close]");
  if (t) closeModal(t.getAttribute("data-close"));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $$(".modal:not([hidden]), .drawer:not([hidden])").forEach(m => closeModal(m.id));
  }
});

/* ------------------ Order flow ------------------ */
function renderOrderSummary() {
  const cart = readCart();
  const host = $("#orderSummary");
  if (!host) return;
  host.replaceChildren();
  if (!cart.length) return;
  const list = el("ul", { class: "order-items" });
  let total = 0;
  cart.forEach(i => {
    const line = (Number(i.price) || 0) * i.qty;
    total += line;
    list.appendChild(el("li", {}, [
      el("span", { text: `${i.name} × ${i.qty}` }),
      el("span", { text: money(line) })
    ]));
  });
  host.append(
    el("h4", { style: "margin:0 0 8px", text: "Order summary" }),
    list,
    el("div", { class: "order-total row" }, [
      el("span", { text: "Estimated total" }),
      el("span", { class: "spacer" }),
      el("strong", { text: money(total) })
    ]),
    el("p", { class: "muted small", text: "Authoritative pricing is confirmed by our team before fulfilment." })
  );
}

async function submitOrder(e) {
  e.preventDefault();
  const cart = readCart();
  if (!cart.length) { toast("Your cart is empty.", "error"); return; }

  const name = $("#ofName").value.trim();
  const contact = $("#ofContact").value.trim();
  const method = $("#ofMethod").value;
  const txn = $("#ofTxn").value.trim();
  const note = $("#ofNote").value.trim();

  $$(".error[data-error-for]").forEach(n => n.textContent = "");
  let ok = true;
  if (name.length < 2) { $('[data-error-for="ofName"]').textContent = "Please enter your full name."; ok = false; }
  if (contact.length < 6) { $('[data-error-for="ofContact"]').textContent = "Please enter a valid contact number."; ok = false; }
  if (method !== "cash" && txn.length < 3) { $('[data-error-for="ofTxn"]').textContent = "Transaction reference is required."; ok = false; }
  if (!ok) return;

  const btn = $("#placeOrderBtn");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting…`;

  try {
    if (!auth.currentUser) {
      toast("Please sign in to place an order.", "error", "Sign in required");
      setTimeout(() => { window.location.href = "login.html?next=index.html"; }, 600);
      return;
    }

    const createOrder = httpsCallable(functions, "createOrder");
    const payload = {
      customerName: name,
      contactNumber: contact,
      paymentMethod: method,
      transactionReference: txn || null,
      note: note || null,
      items: cart.map(i => ({ productId: i.id, qty: i.qty }))
    };
    const res = await createOrder(payload);
    const data = res.data || {};
    if (!data.ok) throw new Error(data.message || "Order could not be created.");

    localStorage.removeItem(CART_KEY);
    updateCartUi();
    closeModal("orderModal");
    toast(`Order ${data.orderId || ""} submitted. Our team will verify it shortly.`, "success", "Order submitted");
    setTimeout(() => { window.location.href = "orders.html"; }, 800);
  } catch (err) {
    console.error(err);
    const code = err?.code || "";
    let msg = err?.message || "We could not submit your order. Please try again.";
    if (code === "functions/unauthenticated") msg = "Please sign in again to place this order.";
    if (code === "functions/failed-precondition") msg = "One or more products became unavailable. Please refresh.";
    if (code === "functions/not-found") msg = "A product in your cart no longer exists.";
    toast(msg, "error", "Order failed");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ------------------ Header / auth UI ------------------ */
function renderAccount() {
  const slot = $("#accountSlot");
  const mobile = $("#mobileAccountSlot");
  if (slot) slot.replaceChildren();
  if (mobile) mobile.replaceChildren();

  if (state.user) {
    const initial = (state.user.displayName || state.user.email || "U").trim().charAt(0).toUpperCase();
    const chip = el("button", { class: "avatar-chip", type: "button",
      onclick: () => { window.location.href = "account.html"; } }, [
      el("span", { class: "avatar", text: initial }),
      el("span", { text: (state.user.displayName || "My account").split(" ")[0] })
    ]);
    if (slot) slot.appendChild(chip);
    if (mobile) mobile.appendChild(el("a", { class: "mobile-link", href: "account.html" },
      [el("i", { class: "fa-solid fa-user" }), " My account"]));
    if (mobile) mobile.appendChild(el("button", { class: "mobile-link", type: "button",
      onclick: async () => { await signOut(auth); window.location.reload(); } },
      [el("i", { class: "fa-solid fa-right-from-bracket" }), " Sign out"]));
  } else {
    if (slot) slot.appendChild(el("a", { class: "btn btn-primary btn-sm", href: "login.html" },
      [el("i", { class: "fa-solid fa-right-to-bracket" }), " Sign in"]));
    if (mobile) mobile.appendChild(el("a", { class: "mobile-link", href: "login.html" },
      [el("i", { class: "fa-solid fa-right-to-bracket" }), " Sign in"]));
    if (mobile) mobile.appendChild(el("a", { class: "mobile-link", href: "register.html" },
      [el("i", { class: "fa-solid fa-user-plus" }), " Create account"]));
  }
}

/* ------------------ Wiring ------------------ */
function bindSearch() {
  const nav = $("#navSearch");
  const mob = $("#mobileSearch");
  const clear = $("#searchClear");
  const apply = (val) => {
    state.search = val || "";
    if (nav) nav.value = state.search;
    if (mob) mob.value = state.search;
    if (clear) clear.hidden = !state.search;
    renderAllGrid();
  };
  let t;
  const debounced = (v) => { clearTimeout(t); t = setTimeout(() => apply(v), 180); };
  nav?.addEventListener("input", (e) => debounced(e.target.value));
  mob?.addEventListener("input", (e) => debounced(e.target.value));
  clear?.addEventListener("click", () => apply(""));
}

function bindFilters() {
  $("#filterCategory")?.addEventListener("change", (e) => {
    state.categoryId = e.target.value;
    renderCategoryChips();
    renderAllGrid();
  });
  $("#sortSelect")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderAllGrid();
  });
  $("#resetFiltersBtn")?.addEventListener("click", () => {
    state.search = ""; state.categoryId = ""; state.sort = "newest";
    const nav = $("#navSearch"); if (nav) nav.value = "";
    const mob = $("#mobileSearch"); if (mob) mob.value = "";
    const sort = $("#sortSelect"); if (sort) sort.value = "newest";
    renderCategoryChips(); renderCategorySelect(); renderAllGrid();
  });
}

function bindMenu() {
  const toggle = $("#menuToggle");
  const menu = $("#mobileMenu");
  toggle?.addEventListener("click", () => {
    const open = !menu.hidden;
    menu.hidden = open;
    toggle.setAttribute("aria-expanded", String(!open));
  });
  $$("#mobileMenu a[href^='#']").forEach(a => a.addEventListener("click", () => {
    menu.hidden = true; toggle?.setAttribute("aria-expanded", "false");
  }));
}

function bindCart() {
  $("#cartBtn")?.addEventListener("click", () => openModal("cartDrawer"));
  $("#cartBtnMobile")?.addEventListener("click", () => {
    $("#mobileMenu").hidden = true;
    openModal("cartDrawer");
  });
  $("#checkoutBtn")?.addEventListener("click", () => {
    if (!readCart().length) return;
    if (!auth.currentUser) {
      toast("Please sign in to submit an order.", "info", "Sign in required");
      setTimeout(() => { window.location.href = "login.html?next=index.html"; }, 600);
      return;
    }
    closeModal("cartDrawer");
    renderOrderSummary();
    const u = auth.currentUser;
    if (u) $("#ofName").value = u.displayName || "";
    openModal("orderModal");
  });
  $("#orderForm")?.addEventListener("submit", submitOrder);
}

/* ------------------ Init ------------------ */
function init() {
  const year = $("#year"); if (year) year.textContent = String(new Date().getFullYear());
  updateCartUi();
  bindSearch();
  bindFilters();
  bindMenu();
  bindCart();
  renderAccount();

  loadCategories();
  loadProducts();

  state.unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    state.user = user || null;
    renderAccount();
    updateCartUi();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

window.addEventListener("beforeunload", () => {
  if (typeof state.unsubscribeAuth === "function") state.unsubscribeAuth();
});
