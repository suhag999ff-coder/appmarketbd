/* admin.js — single-page admin controller */
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='55%' font-family='sans-serif' font-size='10' fill='#4f46e5' text-anchor='middle' font-weight='700'>AV</text></svg>`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const money = (n) => (Number(n) || 0) > 0 ? "৳" + Number(n).toLocaleString("en-BD") : "Free";
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try { const url = new URL(u); return (url.protocol === "http:" || url.protocol === "https:") ? url.href : ""; }
  catch { return ""; }
};

const state = {
  user: null,
  isAdmin: false,
  view: "dashboard",
  products: [],
  categories: [],
  orders: [],
  users: []
};

/* ---------- Toast ---------- */
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
    el.style.opacity = "0";
    el.style.transform = "translateY(-10px)";
    setTimeout(() => el.remove(), 260);
  }, 4000);
}

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
  if (!document.querySelector(".modal:not([hidden])")) document.body.style.overflow = "";
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) closeM(c.dataset.close);
});

/* ---------- Sidebar ---------- */
function openSidebar() { $("#adminSidebar").classList.add("open"); $("#sidebarBackdrop").hidden = false; }
function closeSidebar() { $("#adminSidebar").classList.remove("open"); $("#sidebarBackdrop").hidden = true; }
$("#menuBtn")?.addEventListener("click", openSidebar);
$("#sidebarBackdrop")?.addEventListener("click", closeSidebar);

/* ---------- View switching ---------- */
$$(".admin-nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    state.view = v;
    $$(".admin-nav button[data-view]").forEach(b => b.classList.toggle("active", b === btn));
    $$(".admin-view").forEach(sec => sec.hidden = sec.dataset.view !== v);
    const titles = { dashboard: "Dashboard", products: "Products", orders: "Orders", users: "Users", settings: "Settings" };
    $("#pageTitle").textContent = titles[v] || v;
    if (window.innerWidth < 900) closeSidebar();
    if (v === "products") loadProducts();
    if (v === "orders") loadOrders();
    if (v === "users") loadUsers();
    if (v === "settings") loadSettings();
    if (v === "dashboard") loadDashboard();
  });
});

/* ---------- Confirm helper ---------- */
function confirmAction(title, msg) {
  return new Promise((resolve) => {
    $("#confirmTitle").textContent = title;
    $("#confirmMsg").textContent = msg;
    openM("confirmModal");
    const done = (ok) => {
      closeM("confirmModal");
      $("#confirmYes").removeEventListener("click", onYes);
      $("#confirmNo").removeEventListener("click", onNo);
      resolve(ok);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    $("#confirmYes").addEventListener("click", onYes);
    $("#confirmNo").addEventListener("click", onNo);
  });
}

/* ---------- Admin check ---------- */
async function checkAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists() && snap.data().enabled === true;
  } catch (err) {
    console.warn("[admin] check failed:", err);
    return false;
  }
}

/* ---------- Login flow ---------- */
$("#adminLoginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#adminEmailInput").value.trim();
  const password = $("#adminPasswordInput").value;
  const errBox = $("#loginErr");
  errBox.hidden = true;

  const btn = $("#adminLoginBtn");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying…`;

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const ok = await checkAdmin(cred.user.uid);
    if (!ok) {
      await signOut(auth);
      errBox.hidden = false;
      errBox.innerHTML = `<i class="fa-solid fa-lock"></i><div><strong>Access denied.</strong><br>Your account is not authorized as an administrator.</div>`;
      throw new Error("Not admin");
    }
    // Success
    closeM("loginModal");
    state.user = cred.user;
    state.isAdmin = true;
    $("#adminEmail").textContent = cred.user.email || "";
    initApp();
  } catch (err) {
    if (err.message !== "Not admin") {
      const map = {
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/user-not-found": "No account with this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/too-many-requests": "Too many attempts. Try again later."
      };
      errBox.hidden = false;
      errBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><div>${map[err.code] || err.message || "Sign in failed."}</div>`;
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
});

/* ---------- Logout ---------- */
$("#adminLogout")?.addEventListener("click", async () => {
  if (!(await confirmAction("Sign out?", "You will be signed out of the admin panel."))) return;
  await signOut(auth);
  location.reload();
});

/* ==========================================================
   DATA LOADERS
   ========================================================== */

async function loadDashboard() {
  const grid = $("#statGrid");
  grid.innerHTML = `<div class="stat-card"><span class="stat-label">Loading…</span><span class="stat-value">—</span></div>`;
  try {
    const [pSnap, oSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "orders"))
    ]);
    const products = pSnap.docs.map(d => d.data());
    const orders = oSnap.docs.map(d => d.data());

    const stats = {
      products: products.length,
      available: products.filter(p => p.available === true).length,
      orders: orders.length,
      pending: orders.filter(o => o.status === "pending").length,
      completed: orders.filter(o => o.status === "completed").length
    };
    grid.innerHTML = "";
    const defs = [
      { label: "Products", value: stats.products, icon: "fa-box" },
      { label: "Available", value: stats.available, icon: "fa-circle-check" },
      { label: "Orders", value: stats.orders, icon: "fa-receipt" },
      { label: "Pending", value: stats.pending, icon: "fa-hourglass-half" },
      { label: "Completed", value: stats.completed, icon: "fa-flag-checkered" }
    ];
    defs.forEach(d => {
      const c = document.createElement("div");
      c.className = "stat-card";
      c.innerHTML = `<span class="stat-label">${d.label}</span>
        <span class="stat-value">${d.value}</span>
        <i class="fa-solid ${d.icon} stat-icon"></i>`;
      grid.appendChild(c);
    });

    // Recent orders
    const recent = oSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 5);

    const ro = $("#recentOrders");
    if (!recent.length) {
      ro.innerHTML = `<div class="empty-state"><i class="fa-regular fa-receipt"></i><h3>No orders yet</h3></div>`;
    } else {
      ro.innerHTML = recent.map(o => `
        <div class="admin-item">
          <div class="admin-item-info">
            <strong>${esc(o.customerName || "Customer")}</strong>
            <div class="meta">${money(o.total)} · ${o.items?.length || 0} items</div>
          </div>
          <span class="status status-${o.status || "pending"}">${o.status || "pending"}</span>
        </div>`).join("");
    }
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="alert alert-danger"><i class="fa-solid fa-circle-exclamation"></i>
      <div>Failed to load stats. Check Firestore rules.</div></div>`;
  }
}

async function loadCategories() {
  const snap = await getDocs(collection(db, "categories"));
  state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const sel = $("#pCategory");
  if (sel) {
    sel.innerHTML = `<option value="">Select…</option>`;
    state.categories.forEach(c => {
      sel.appendChild(new Option(c.name, c.id));
    });
  }
}

async function loadProducts() {
  const wrap = $("#productsList");
  wrap.innerHTML = `<div class="skeleton" style="height:80px;margin:12px"></div>`;
  try {
    await loadCategories();
    const snap = await getDocs(collection(db, "products"));
    state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderProducts();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="alert alert-danger"><i class="fa-solid fa-circle-exclamation"></i><div>Failed to load products.</div></div>`;
  }
}

function renderProducts() {
  const wrap = $("#productsList");
  const term = ($("#productSearch")?.value || "").toLowerCase().trim();
  const items = !term ? state.products : state.products.filter(p =>
    (p.name || "").toLowerCase().includes(term) ||
    (p.categoryName || "").toLowerCase().includes(term));

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-box"></i>
      <h3>No products</h3><p>Click "New product" to add one.</p></div>`;
    return;
  }
  wrap.innerHTML = "";
  items.forEach(p => {
    const row = document.createElement("div");
    row.className = "admin-item";
    row.innerHTML = `
      <img src="${safeUrl(p.imageUrl) || PH}" alt="" onerror="this.src='${PH}'">
      <div class="admin-item-info">
        <strong>${esc(p.name || "Untitled")}</strong>
        <div class="meta">
          ${esc(p.categoryName || "—")} · ${money(p.price)}
          ${p.featured ? ' · <span style="color:var(--primary);font-weight:700">Featured</span>' : ""}
          ${p.available === false ? ' · <span style="color:var(--danger);font-weight:700">Unavailable</span>' : ""}
        </div>
      </div>
      <div class="admin-item-actions">
        <button data-edit="${p.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button data-del="${p.id}" class="danger" title="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    wrap.appendChild(row);
  });
}

async function loadOrders() {
  const wrap = $("#ordersList");
  wrap.innerHTML = `<div class="skeleton" style="height:80px;margin:12px"></div>`;
  try {
    const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)));
    state.orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders();
  } catch (err) {
    console.error(err);
    // Fallback without order
    try {
      const snap = await getDocs(collection(db, "orders"));
      state.orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      renderOrders();
    } catch (e) {
      wrap.innerHTML = `<div class="alert alert-danger"><i class="fa-solid fa-circle-exclamation"></i><div>Failed to load orders.</div></div>`;
    }
  }
}

function renderOrders() {
  const wrap = $("#ordersList");
  const term = ($("#orderSearch")?.value || "").toLowerCase().trim();
  const status = $("#orderStatusFilter")?.value || "";
  let items = state.orders;
  if (status) items = items.filter(o => o.status === status);
  if (term) items = items.filter(o =>
    (o.customerName || "").toLowerCase().includes(term) ||
    (o.contactNumber || "").toLowerCase().includes(term) ||
    (o.id || "").toLowerCase().includes(term));

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-receipt"></i>
      <h3>No orders</h3><p>No matching orders found.</p></div>`;
    return;
  }
  wrap.innerHTML = "";
  items.forEach(o => {
    const row = document.createElement("div");
    row.className = "admin-item";
    row.innerHTML = `
      <div class="admin-item-info">
        <strong>${esc(o.customerName || "—")}</strong>
        <div class="meta">${esc(o.contactNumber || "—")} · ${money(o.total)}</div>
        <div class="meta" style="margin-top:2px">#${o.id.slice(0, 8)} · ${o.items?.length || 0} items</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span class="status status-${o.status || "pending"}">${o.status || "pending"}</span>
        <button class="btn btn-ghost btn-sm" data-view-order="${o.id}">View</button>
      </div>`;
    wrap.appendChild(row);
  });
}

async function loadUsers() {
  const wrap = $("#usersList");
  wrap.innerHTML = `<div class="skeleton" style="height:80px;margin:12px"></div>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    state.users = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderUsers();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="alert alert-danger"><i class="fa-solid fa-circle-exclamation"></i>
      <div>Failed to load users. Ensure Firestore rules allow admin read.</div></div>`;
  }
}

function renderUsers() {
  const wrap = $("#usersList");
  if (!state.users.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-users"></i><h3>No users yet</h3></div>`;
    return;
  }
  wrap.innerHTML = "";
  state.users.forEach(u => {
    const row = document.createElement("div");
    row.className = "admin-item";
    const initial = (u.displayName || u.email || "U").charAt(0).toUpperCase();
    row.innerHTML = `
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;display:grid;place-items:center;font-weight:700;flex-shrink:0">${esc(initial)}</div>
      <div class="admin-item-info">
        <strong>${esc(u.displayName || "—")}</strong>
        <div class="meta">${esc(u.email || "—")}</div>
      </div>`;
    wrap.appendChild(row);
  });
}

async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "public"));
    if (!snap.exists()) return;
    const d = snap.data();
    if ($("#sStoreName")) $("#sStoreName").value = d.storeName || "AppVerse";
    if ($("#sEmail")) $("#sEmail").value = d.contactEmail || "";
    if ($("#sPhone")) $("#sPhone").value = d.contactPhone || "";
    if ($("#sBkash")) $("#sBkash").value = d.bkashNumber || "";
    if ($("#sNagad")) $("#sNagad").value = d.nagadNumber || "";
  } catch (err) { console.warn(err); }
}

/* ==========================================================
   EVENT WIRING
   ========================================================== */

// Search filters
$("#productSearch")?.addEventListener("input", renderProducts);
$("#orderSearch")?.addEventListener("input", renderOrders);
$("#orderStatusFilter")?.addEventListener("change", renderOrders);

// New product
$("#newProductBtn")?.addEventListener("click", () => openProductEditor(null));

// Edit / Delete (delegated)
document.addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    const p = state.products.find(x => x.id === edit.dataset.edit);
    if (p) openProductEditor(p);
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    const p = state.products.find(x => x.id === del.dataset.del);
    if (!p) return;
    const ok = await confirmAction("Delete product?", `"${p.name}" will be permanently deleted.`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "products", p.id));
      toast("Product deleted", "success");
      await loadProducts();
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }
  const vo = e.target.closest("[data-view-order]");
  if (vo) {
    const o = state.orders.find(x => x.id === vo.dataset.viewOrder);
    if (o) showOrderDetail(o);
  }
});

// Product form
function openProductEditor(p) {
  $("#productModalTitle").innerHTML = `<i class="fa-solid fa-box"></i> ${p ? "Edit" : "New"} product`;
  $("#pId").value = p?.id || "";
  $("#pName").value = p?.name || "";
  $("#pDescription").value = p?.description || "";
  $("#pImageUrl").value = p?.imageUrl || "";
  $("#pVersion").value = p?.version || "";
  $("#pScreenshots").value = Array.isArray(p?.screenshotUrls) ? p.screenshotUrls.join("\n") : "";
  $("#pPrice").value = p?.price ?? "";
  $("#pOriginalPrice").value = p?.originalPrice ?? "";
  $("#pProductUrl").value = p?.productUrl || "";
  $("#pFeatured").checked = p?.featured === true;
  $("#pAvailable").checked = p?.available !== false;
  $("#pCategory").value = p?.categoryId || "";
  $$(".error[data-err]").forEach(n => n.textContent = "");
  openM("productModal");
}

$("#productForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("#pId").value;
  const name = $("#pName").value.trim();
  const description = $("#pDescription").value.trim();
  const imageUrl = $("#pImageUrl").value.trim();
  const categoryId = $("#pCategory").value;
  const price = Number($("#pPrice").value);
  const originalPrice = Number($("#pOriginalPrice").value || 0);
  const version = $("#pVersion").value.trim();
  const productUrl = $("#pProductUrl").value.trim();
  const screenshotUrls = $("#pScreenshots").value.split(/\s*\n\s*/).filter(Boolean).slice(0, 12);
  const featured = $("#pFeatured").checked;
  const available = $("#pAvailable").checked;

  $$(".error[data-err]").forEach(n => n.textContent = "");
  let ok = true;
  if (name.length < 2) { $('[data-err="pName"]').textContent = "Name required"; ok = false; }
  if (!safeUrl(imageUrl)) { $('[data-err="pImageUrl"]').textContent = "Valid https URL required"; ok = false; }
  if (!categoryId) { toast("Select a category", "error"); ok = false; }
  if (!Number.isFinite(price) || price < 0) { toast("Invalid price", "error"); ok = false; }
  if (!ok) return;

  const btn = $("#saveProductBtn");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;

  const catName = state.categories.find(c => c.id === categoryId)?.name || "";
  const payload = {
    name, description, imageUrl, categoryId, categoryName: catName,
    price, originalPrice, version, productUrl: productUrl || null,
    screenshotUrls, featured, available,
    updatedAt: serverTimestamp()
  };

  try {
    if (id) {
      await updateDoc(doc(db, "products", id), payload);
      toast("Product updated", "success");
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), payload);
      toast("Product created", "success");
    }
    closeM("productModal");
    await loadProducts();
  } catch (err) {
    console.error(err);
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
});

// Order detail
function showOrderDetail(o) {
  const items = (o.items || []).map(i =>
    `<div class="order-line"><span>${esc(i.name)} × ${i.qty}</span><span>${money((i.price || 0) * i.qty)}</span></div>`
  ).join("");
  const html = `
    <h3 class="modal-title"><i class="fa-solid fa-receipt"></i> Order details</h3>
    <div class="detail-row"><span>Order ID</span><span style="word-break:break-all;font-size:0.75rem">${esc(o.id)}</span></div>
    <div class="detail-row"><span>Customer</span><span>${esc(o.customerName || "—")}</span></div>
    <div class="detail-row"><span>Phone</span><span>${esc(o.contactNumber || "—")}</span></div>
    <div class="detail-row"><span>Payment</span><span>${esc(o.paymentMethod || "—")}</span></div>
    ${o.transactionReference ? `<div class="detail-row"><span>Ref</span><span>${esc(o.transactionReference)}</span></div>` : ""}
    ${o.createdAt?.toDate?.() ? `<div class="detail-row"><span>Date</span><span>${o.createdAt.toDate().toLocaleString()}</span></div>` : ""}
    <h4 style="margin:16px 0 8px;font-size:0.9rem">Items</h4>
    ${items}
    <div class="order-total"><span>Total</span><span>${money(o.total)}</span></div>
    ${o.note ? `<div class="alert alert-info" style="margin-top:12px"><i class="fa-solid fa-note-sticky"></i><div>${esc(o.note)}</div></div>` : ""}
    <div class="field" style="margin-top:14px">
      <label>Update status</label>
      <select id="orderStatusSelect">
        <option value="pending"${o.status === "pending" ? " selected" : ""}>Pending</option>
        <option value="confirmed"${o.status === "confirmed" ? " selected" : ""}>Confirmed</option>
        <option value="completed"${o.status === "completed" ? " selected" : ""}>Completed</option>
        <option value="cancelled"${o.status === "cancelled" ? " selected" : ""}>Cancelled</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="orderDetailModal">Close</button>
      <button class="btn btn-primary" id="saveOrderStatusBtn"><i class="fa-solid fa-floppy-disk"></i> Save status</button>
    </div>`;
  $("#orderDetailBody").innerHTML = html;
  openM("orderDetailModal");
  $("#saveOrderStatusBtn").addEventListener("click", async () => {
    const newStatus = $("#orderStatusSelect").value;
    const btn = $("#saveOrderStatusBtn");
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
    try {
      await updateDoc(doc(db, "orders", o.id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      toast("Status updated", "success");
      closeM("orderDetailModal");
      await loadOrders();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
}

// Settings form
$("#settingsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
  try {
    await setDocRef();
    toast("Settings saved", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
});

async function setDocRef() {
  const { setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await setDoc(doc(db, "settings", "public"), {
    storeName: $("#sStoreName").value.trim(),
    contactEmail: $("#sEmail").value.trim(),
    contactPhone: $("#sPhone").value.trim(),
    bkashNumber: $("#sBkash").value.trim(),
    nagadNumber: $("#sNagad").value.trim(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/* ==========================================================
   INIT
   ========================================================== */
function initApp() {
  loadCategories();
  loadDashboard();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    openM("loginModal");
    return;
  }
  const ok = await checkAdmin(user.uid);
  if (!ok) {
    // Non-admin signed in — show login modal with error
    const errBox = $("#loginErr");
    errBox.hidden = false;
    errBox.innerHTML = `<i class="fa-solid fa-lock"></i><div><strong>Access denied.</strong><br>Your account is not authorized as an administrator.</div>`;
    openM("loginModal");
    return;
  }
  state.user = user;
  state.isAdmin = true;
  $("#adminEmail").textContent = user.email || "";
  closeM("loginModal");
  initApp();
});