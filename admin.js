/* admin.js — Admin panel with Firestore-stored Telegram config */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy, limit, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='55%' font-family='sans-serif' font-size='10' fill='#4f46e5' text-anchor='middle' font-weight='700'>AV</text></svg>`);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const money = (n) => (Number(n)||0) > 0 ? "৳" + Number(n).toLocaleString("en-BD") : "Free";
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try { const x = new URL(u); return ["http:","https:"].includes(x.protocol) ? x.href : ""; }
  catch { return ""; }
};

const state = {
  user: null, isAdmin: false, view: "dashboard",
  products: [], categories: [], orders: [], users: [], adminUids: new Set()
};

const fns = getFunctions();
const bootstrapAdminCall = httpsCallable(fns, "bootstrapAdmin");
const testTelegramCall   = httpsCallable(fns, "testTelegram");
const grantAdminCall     = httpsCallable(fns, "grantAdmin");

/* ─── Toast & Modals ─── */
function toast(msg, type = "info", title) {
  const stack = $("#toasts"); if (!stack) return;
  const icons = { info:"fa-circle-info", success:"fa-circle-check", error:"fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i>
    <div class="toast-body">${title ? `<strong>${esc(title)}</strong>` : ""}${esc(msg)}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 260); }, 4500);
}
function openM(id) { const m = document.getElementById(id); if (m) { m.hidden = false; document.body.style.overflow = "hidden"; } }
function closeM(id) { const m = document.getElementById(id); if (m) {
  m.hidden = true;
  if (!document.querySelector(".modal:not([hidden])")) document.body.style.overflow = "";
} }
document.addEventListener("click", e => { const c = e.target.closest("[data-close]"); if (c) closeM(c.dataset.close); });

/* ─── Sidebar ─── */
$("#menuBtn")?.addEventListener("click", () => {
  $("#adminSidebar").classList.add("open"); $("#sidebarBackdrop").hidden = false;
});
$("#sidebarBackdrop")?.addEventListener("click", () => {
  $("#adminSidebar").classList.remove("open"); $("#sidebarBackdrop").hidden = true;
});

/* ─── Secret toggle (show/hide password) ─── */
document.addEventListener("click", e => {
  const t = e.target.closest(".secret-toggle");
  if (!t) return;
  const input = document.getElementById(t.dataset.target);
  if (!input) return;
  const isPwd = input.type === "password";
  input.type = isPwd ? "text" : "password";
  t.innerHTML = isPwd ? `<i class="fa-regular fa-eye-slash"></i>` : `<i class="fa-regular fa-eye"></i>`;
});

/* ─── View switching ─── */
$$(".admin-nav button[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.view;
    state.view = v;
    $$(".admin-nav button[data-view]").forEach(b => b.classList.toggle("active", b === btn));
    $$(".admin-view").forEach(sec => sec.hidden = sec.dataset.view !== v);
    const titles = {
      dashboard:"Dashboard", products:"Products", categories:"Categories",
      orders:"Orders", users:"Users", settings:"Settings"
    };
    $("#pageTitle").textContent = titles[v] || v;
    if (window.innerWidth < 900) {
      $("#adminSidebar").classList.remove("open"); $("#sidebarBackdrop").hidden = true;
    }
    if (v === "products")   loadProducts();
    if (v === "categories") loadCategoriesAdmin();
    if (v === "orders")     loadOrders();
    if (v === "users")      loadUsers();
    if (v === "settings")   loadSettings();
    if (v === "dashboard")  loadDashboard();
  });
});

/* ─── Confirm ─── */
function confirmAction(title, msg) {
  return new Promise(resolve => {
    $("#confirmTitle").textContent = title;
    $("#confirmMsg").textContent = msg;
    openM("confirmModal");
    const done = ok => {
      closeM("confirmModal");
      $("#confirmYes").removeEventListener("click", onYes);
      $("#confirmNo").removeEventListener("click", onNo);
      resolve(ok);
    };
    const onYes = () => done(true);
    const onNo  = () => done(false);
    $("#confirmYes").addEventListener("click", onYes);
    $("#confirmNo").addEventListener("click", onNo);
  });
}

/* ─── Admin check ─── */
async function checkAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists() && snap.data().enabled === true;
  } catch { return false; }
}

/* ─── Claim admin (bootstrap) ─── */
$("#claimAdminBtn")?.addEventListener("click", async () => {
  if (!auth.currentUser) {
    return toast("Sign in first, then click Claim admin", "error");
  }
  const btn = $("#claimAdminBtn"); const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking…`;
  try {
    const res = await bootstrapAdminCall();
    toast(`You are now admin (${res.data.email})`, "success");
    const ok = await checkAdmin(auth.currentUser.uid);
    if (ok) { state.user = auth.currentUser; state.isAdmin = true;
      $("#adminEmail").textContent = auth.currentUser.email || "";
      closeM("loginModal"); initApp();
    }
  } catch (err) {
    toast(err?.message || "Claim failed", "error");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
});

/* ─── Login ─── */
$("#adminLoginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = $("#adminEmailInput").value.trim();
  const password = $("#adminPasswordInput").value;
  const errBox = $("#loginErr"); errBox.hidden = true;
  const btn = $("#adminLoginBtn"); const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying…`;

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const ok = await checkAdmin(cred.user.uid);
    if (!ok) {
      errBox.hidden = false;
      errBox.innerHTML = `<i class="fa-solid fa-lock"></i>
        <div><strong>Not an admin.</strong> If you are the first admin, click "Claim admin access" below. Otherwise ask an existing admin.</div>`;
      btn.disabled = false; btn.innerHTML = orig;
      return;
    }
    closeM("loginModal");
    state.user = cred.user; state.isAdmin = true;
    $("#adminEmail").textContent = cred.user.email || "";
    initApp();
  } catch (err) {
    errBox.hidden = false;
    errBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><div>${esc(err.message || "Sign in failed.")}</div>`;
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
});

$("#adminLogout")?.addEventListener("click", async () => {
  if (await confirmAction("Sign out?", "You will be signed out.")) {
    await signOut(auth); location.reload();
  }
});

/* ═══ DASHBOARD ═══ */
async function loadDashboard() {
  const grid = $("#statGrid");
  grid.innerHTML = `<div class="stat-card"><span class="stat-label">Loading…</span><span class="stat-value">—</span></div>`;
  try {
    const [pSnap, oSnap, uSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "orders")),
      getDocs(collection(db, "users"))
    ]);
    const products = pSnap.docs.map(d => d.data());
    const orders   = oSnap.docs.map(d => d.data());

    const revenue = orders
      .filter(o => ["delivered","completed"].includes(o.status))
      .reduce((s,o) => s + (Number(o.total)||0), 0);

    const defs = [
      { label:"Products",   value: products.length,                                icon:"fa-box" },
      { label:"Available",  value: products.filter(p => p.available===true).length, icon:"fa-circle-check" },
      { label:"Orders",     value: orders.length,                                  icon:"fa-receipt" },
      { label:"Pending",    value: orders.filter(o => o.status==="pending").length, icon:"fa-hourglass-half" },
      { label:"Revenue",    value: money(revenue),                                 icon:"fa-sack-dollar" },
      { label:"Users",      value: uSnap.size,                                     icon:"fa-users" }
    ];
    grid.innerHTML = "";
    defs.forEach(d => {
      const c = document.createElement("div");
      c.className = "stat-card";
      c.innerHTML = `<span class="stat-label">${d.label}</span>
        <span class="stat-value">${typeof d.value === "number" ? d.value : esc(d.value)}</span>
        <i class="fa-solid ${d.icon} stat-icon"></i>`;
      grid.appendChild(c);
    });

    const recent = oSnap.docs
      .map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
      .slice(0, 5);
    const ro = $("#recentOrders");
    ro.innerHTML = recent.length
      ? recent.map(o => `
        <div class="admin-item">
          <div class="admin-item-info">
            <strong>${esc(o.customerName||"Customer")}</strong>
            <div class="meta">${money(o.total)} · ${(o.items||[]).length} items</div>
          </div>
          <span class="status status-${esc(o.status||"pending")}">${esc(o.status||"pending")}</span>
        </div>`).join("")
      : `<div class="empty-state"><i class="fa-regular fa-receipt"></i><h3>No orders yet</h3></div>`;
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="alert alert-danger">Failed to load stats.</div>`;
  }
}

/* ═══ CATEGORIES ═══ */
async function loadCategories() {
  const snap = await getDocs(collection(db, "categories"));
  state.categories = snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => (a.name||"").localeCompare(b.name||""));
  const sel = $("#pCategory");
  if (sel) {
    sel.innerHTML = `<option value="">Select…</option>`;
    state.categories.forEach(c => sel.appendChild(new Option(c.name, c.id)));
  }
}

/* ═══ PRODUCTS ═══ */
async function loadProducts() {
  const wrap = $("#productsList");
  wrap.innerHTML = `<div class="skeleton" style="height:80px;margin:12px"></div>`;
  try {
    await loadCategories();
    const snap = await getDocs(collection(db, "products"));
    state.products = snap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    renderProducts();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="alert alert-danger">Failed to load products.</div>`;
  }
}

function renderProducts() {
  const wrap = $("#productsList");
  const term = ($("#productSearch")?.value || "").toLowerCase().trim();
  const items = !term ? state.products : state.products.filter(p =>
    (p.name||"").toLowerCase().includes(term) ||
    (p.categoryName||"").toLowerCase().includes(term));

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-box"></i><h3>No products</h3></div>`;
    return;
  }
  wrap.innerHTML = "";
  items.forEach(p => {
    const row = document.createElement("div");
    row.className = "admin-item";
    row.innerHTML = `
      <img src="${safeUrl(p.imageUrl)||PH}" alt="" onerror="this.src='${PH}'">
      <div class="admin-item-info">
        <strong>${esc(p.name||"Untitled")}</strong>
        <div class="meta">${esc(p.categoryName||"—")} · ${money(p.price)}
          ${p.featured ? '· <span style="color:var(--primary)">Featured</span>' : ""}
          ${p.available === false ? '· <span style="color:var(--danger)">Hidden</span>' : ""}
        </div>
      </div>
      <div class="admin-item-actions">
        <button data-edit="${p.id}"><i class="fa-solid fa-pen"></i></button>
        <button data-del="${p.id}" class="danger"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    wrap.appendChild(row);
  });
}

async function loadCategoriesAdmin() {
  const wrap = $("#categoriesList");
  wrap.innerHTML = `<div class="skeleton" style="height:60px;margin:12px"></div>`;
  try {
    await loadCategories();
    wrap.innerHTML = "";
    if (!state.categories.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-tags"></i><h3>No categories</h3></div>`;
      return;
    }
    state.categories.forEach(c => {
      const row = document.createElement("div");
      row.className = "admin-item";
      row.innerHTML = `
        <div class="admin-item-info">
          <strong>${esc(c.name)}</strong>
          <div class="meta">Slug: ${esc(c.slug)}
            ${c.active !== false ? '· <span style="color:var(--success)">Active</span>' : '· <span style="color:var(--danger)">Hidden</span>'}
          </div>
        </div>
        <div class="admin-item-actions">
          <button data-edit-cat="${c.id}"><i class="fa-solid fa-pen"></i></button>
          <button data-del-cat="${c.id}" class="danger"><i class="fa-solid fa-trash"></i></button>
        </div>`;
      wrap.appendChild(row);
    });
  } catch (err) {
    wrap.innerHTML = `<div class="alert alert-danger">Failed to load categories.</div>`;
  }
}

function openCategoryEditor(c) {
  $("#categoryModalTitle").innerHTML = `<i class="fa-solid fa-tag"></i> ${c ? "Edit" : "New"} category`;
  $("#cId").value   = c?.id || "";
  $("#cName").value = c?.name || "";
  $("#cSlug").value = c?.slug || "";
  $("#cActive").checked = c ? c.active !== false : true;
  openM("categoryModal");
}
$("#newCategoryBtn")?.addEventListener("click", () => openCategoryEditor(null));
$("#categoryForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id   = $("#cId").value;
  const name = $("#cName").value.trim();
  const slug = $("#cSlug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g,"-");
  if (!name || !slug) return toast("Name & Slug required","error");
  const payload = { name, slug, active: $("#cActive").checked, updatedAt: serverTimestamp() };
  try {
    if (id) await updateDoc(doc(db, "categories", id), payload);
    else { payload.createdAt = serverTimestamp(); await addDoc(collection(db, "categories"), payload); }
    toast("Category saved", "success");
    closeM("categoryModal");
    loadCategoriesAdmin();
  } catch (err) { toast(err.message, "error"); }
});

/* ═══ ORDERS ═══ */
const ORDER_STATUSES = [
  { value:"pending",           label:"Pending" },
  { value:"payment_submitted", label:"Payment submitted" },
  { value:"under_review",      label:"Under review" },
  { value:"payment_verified",  label:"Payment verified" },
  { value:"delivered",         label:"Delivered" },
  { value:"completed",         label:"Completed" },
  { value:"cancelled",         label:"Cancelled" },
  { value:"refunded",          label:"Refunded" }
];

async function loadOrders() {
  const wrap = $("#ordersList");
  wrap.innerHTML = `<div class="skeleton" style="height:80px;margin:12px"></div>`;
  try {
    const snap = await getDocs(query(collection(db,"orders"), orderBy("createdAt","desc"), limit(200)));
    state.orders = snap.docs.map(d => ({id:d.id, ...d.data()}));
    renderOrders();
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="alert alert-danger">Failed to load orders.</div>`;
  }
}

function renderOrders() {
  const wrap = $("#ordersList");
  const term   = ($("#orderSearch")?.value || "").toLowerCase().trim();
  const status = $("#orderStatusFilter")?.value || "";
  let items = state.orders;
  if (status) items = items.filter(o => o.status === status);
  if (term) items = items.filter(o =>
    (o.customerName||"").toLowerCase().includes(term) ||
    (o.contactNumber||"").includes(term));

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-receipt"></i><h3>No orders</h3></div>`;
    return;
  }
  wrap.innerHTML = "";
  items.forEach(o => {
    const row = document.createElement("div");
    row.className = "admin-item";
    row.innerHTML = `
      <div class="admin-item-info">
        <strong>${esc(o.customerName||"—")}</strong>
        <div class="meta">${esc(o.contactNumber||"—")} · ${money(o.total)}</div>
        <div class="meta">#${esc(o.id.slice(0,8))} · ${(o.items||[]).length} items</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span class="status status-${esc(o.status||"pending")}">${esc(o.status||"pending")}</span>
        <button class="btn btn-ghost btn-sm" data-view-order="${o.id}">View</button>
      </div>`;
    wrap.appendChild(row);
  });
}

/* ═══ USERS + ADMIN MANAGEMENT ═══ */
async function loadUsers() {
  const wrap = $("#usersList");
  wrap.innerHTML = `<div class="skeleton" style="height:80px;margin:12px"></div>`;
  try {
    const [uSnap, aSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "admins"))
    ]);
    state.users = uSnap.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    state.adminUids = new Set(aSnap.docs.filter(d => d.data().enabled === true).map(d => d.id));

    wrap.innerHTML = "";
    if (!state.users.length) {
      wrap.innerHTML = `<div class="empty-state"><i class="fa-regular fa-users"></i><h3>No users yet</h3></div>`;
      return;
    }
    state.users.forEach(u => {
      const isAdmin = state.adminUids.has(u.id);
      const isSelf  = state.user?.uid === u.id;
      const init = (u.displayName || u.email || "U").charAt(0).toUpperCase();
      const row = document.createElement("div");
      row.className = "admin-item";
      row.innerHTML = `
        <div style="width:44px;height:44px;border-radius:50%;background:var(--primary);color:#fff;display:grid;place-items:center;font-weight:700">${esc(init)}</div>
        <div class="admin-item-info">
          <strong>${esc(u.displayName||"—")}
            ${isAdmin ? '<span class="admin-pill"><i class="fa-solid fa-shield-halved"></i> ADMIN</span>' : ""}
            ${isSelf ? '<span class="muted small">(you)</span>' : ""}
          </strong>
          <div class="meta">${esc(u.email||"—")}</div>
        </div>
        <div class="admin-item-actions">
          ${isAdmin
            ? (isSelf
                ? `<button disabled title="You can't revoke yourself"><i class="fa-solid fa-lock"></i></button>`
                : `<button data-revoke-admin="${u.id}" class="danger" title="Revoke admin"><i class="fa-solid fa-user-slash"></i></button>`)
            : `<button data-grant-admin="${u.id}" data-email="${esc(u.email||"")}" title="Make admin"><i class="fa-solid fa-user-shield"></i></button>`}
        </div>`;
      wrap.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="alert alert-danger">Failed to load users.</div>`;
  }
}

/* ═══ SETTINGS ═══ */
async function loadSettings() {
  try {
    const [pub, sec] = await Promise.all([
      getDoc(doc(db,"settings","public")),
      getDoc(doc(db,"settings","secrets")).catch(() => ({ exists: () => false }))
    ]);
    if (pub.exists()) {
      const d = pub.data();
      if ($("#sStoreName")) $("#sStoreName").value = d.storeName || "AppVerse";
      if ($("#sEmail"))     $("#sEmail").value     = d.contactEmail || "";
      if ($("#sPhone"))     $("#sPhone").value     = d.contactPhone || "";
      if ($("#sBkash"))     $("#sBkash").value     = d.bkashNumber || "";
      if ($("#sBkashQr"))   $("#sBkashQr").value   = d.bkashQr || "";
      if ($("#sNagad"))     $("#sNagad").value     = d.nagadNumber || "";
      if ($("#sNagadQr"))   $("#sNagadQr").value   = d.nagadQr || "";
      if ($("#sRocket"))    $("#sRocket").value    = d.rocketNumber || "";
      if ($("#sRocketQr"))  $("#sRocketQr").value  = d.rocketQr || "";
    }
    if (sec.exists && sec.exists()) {
      const d = sec.data();
      if ($("#sTelegramToken")) $("#sTelegramToken").value = d.telegramToken || "";
      if ($("#sTelegramChat"))  $("#sTelegramChat").value  = d.telegramChatId || "";
    }
  } catch (err) { console.warn(err); }
}

/* Store settings form */
$("#storeSettingsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
  try {
    await setDoc(doc(db,"settings","public"), {
      storeName: $("#sStoreName").value.trim(),
      contactEmail: $("#sEmail").value.trim(),
      contactPhone: $("#sPhone").value.trim(),
      bkashNumber: $("#sBkash").value.trim(),
      bkashQr:     $("#sBkashQr").value.trim(),
      nagadNumber: $("#sNagad").value.trim(),
      nagadQr:     $("#sNagadQr").value.trim(),
      rocketNumber:$("#sRocket").value.trim(),
      rocketQr:    $("#sRocketQr").value.trim(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast("Store settings saved", "success");
  } catch (err) { toast(err.message, "error"); }
  finally { btn.disabled = false; btn.innerHTML = orig; }
});

/* Telegram form */
$("#telegramForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("#sTelegramToken").value.trim();
  const chat  = $("#sTelegramChat").value.trim();
  if (!token || !chat) return toast("Both Token and Chat ID required", "error");

  const btn = e.submitter; const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
  try {
    await setDoc(doc(db,"settings","secrets"), {
      telegramToken: token,
      telegramChatId: chat,
      updatedAt: serverTimestamp()
    }, { merge: true });
    toast("Telegram settings saved. Now click 'Send Test' to verify.", "success");
  } catch (err) { toast(err.message, "error"); }
  finally { btn.disabled = false; btn.innerHTML = orig; }
});

/* Test Telegram button */
$("#testTelegramBtn")?.addEventListener("click", async () => {
  const btn = $("#testTelegramBtn"); const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending…`;
  try {
    await testTelegramCall();
    toast("Test message sent — check your Telegram!", "success");
  } catch (err) {
    toast(err?.message || "Test failed. Check token/chat ID.", "error");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
});

/* ═══ CLICK DELEGATION ═══ */
document.addEventListener("click", async (e) => {
  // Products
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
    if (await confirmAction("Delete product?", `"${p.name}" will be deleted.`)) {
      await deleteDoc(doc(db, "products", p.id));
      toast("Deleted","success"); loadProducts();
    }
    return;
  }
  // Categories
  const editCat = e.target.closest("[data-edit-cat]");
  if (editCat) {
    const c = state.categories.find(x => x.id === editCat.dataset.editCat);
    if (c) openCategoryEditor(c);
    return;
  }
  const delCat = e.target.closest("[data-del-cat]");
  if (delCat) {
    const c = state.categories.find(x => x.id === delCat.dataset.delCat);
    if (!c) return;
    if (await confirmAction("Delete category?", `"${c.name}" will be deleted.`)) {
      await deleteDoc(doc(db, "categories", c.id));
      toast("Deleted","success"); loadCategoriesAdmin();
    }
    return;
  }
  // Orders
  const vo = e.target.closest("[data-view-order]");
  if (vo) {
    const o = state.orders.find(x => x.id === vo.dataset.viewOrder);
    if (o) showOrderDetail(o);
    return;
  }
  // Grant admin
  const grant = e.target.closest("[data-grant-admin]");
  if (grant) {
    const uid = grant.dataset.grantAdmin;
    const email = grant.dataset.email || "";
    const ok = await confirmAction(
      "Grant admin access?",
      `${email} will be able to access the admin panel.`
    );
    if (!ok) return;
    grant.disabled = true;
    try {
      await grantAdminCall({ targetUid: uid, email, action: "grant" });
      toast("Admin access granted", "success");
      loadUsers();
    } catch (err) {
      toast(err?.message || "Failed", "error");
      grant.disabled = false;
    }
    return;
  }
  // Revoke admin
  const revoke = e.target.closest("[data-revoke-admin]");
  if (revoke) {
    const uid = revoke.dataset.revokeAdmin;
    const ok = await confirmAction(
      "Revoke admin access?",
      "This user will lose admin privileges immediately."
    );
    if (!ok) return;
    revoke.disabled = true;
    try {
      await grantAdminCall({ targetUid: uid, action: "revoke" });
      toast("Admin access revoked", "success");
      loadUsers();
    } catch (err) {
      toast(err?.message || "Failed", "error");
      revoke.disabled = false;
    }
  }
});

/* ═══ PRODUCT EDITOR ═══ */
function openProductEditor(p) {
  $("#productModalTitle").innerHTML = `<i class="fa-solid fa-box"></i> ${p ? "Edit" : "New"} product`;
  $("#pId").value = p?.id || "";
  $("#pName").value = p?.name || "";
  $("#pDeveloper").value = p?.developer || "";
  $("#pDescription").value = p?.description || "";
  $("#pImageUrl").value = p?.imageUrl || "";
  $("#pVersion").value = p?.version || "";
  $("#pPlatform").value = p?.platform || "";
  $("#pFileSize").value = p?.fileSize || "";
  $("#pTags").value = Array.isArray(p?.tags) ? p.tags.join(", ") : "";
  $("#pScreenshots").value = Array.isArray(p?.screenshotUrls) ? p.screenshotUrls.join("\n") : "";
  $("#pPrice").value = p?.price ?? "";
  $("#pOriginalPrice").value = p?.originalPrice ?? "";
  $("#pFeatures").value = Array.isArray(p?.features) ? p.features.join("\n") : "";
  $("#pRequirements").value = p?.requirements || "";
  $("#pChangelog").value = p?.changelog || "";
  $("#pDownloadUrl").value = "";
  $("#pSeoTitle").value = p?.seoTitle || "";
  $("#pSeoDescription").value = p?.seoDescription || "";
  $("#pFeatured").checked  = p?.featured === true;
  $("#pAvailable").checked = p?.available !== false;
  $("#pCategory").value = p?.categoryId || "";

  if (p?.id) {
    getDoc(doc(db, "products", p.id, "private", "access")).then(s => {
      if (s.exists()) $("#pDownloadUrl").value = s.data().downloadUrl || "";
    }).catch(() => {});
  }
  openM("productModal");
}

$("#newProductBtn")?.addEventListener("click", () => openProductEditor(null));

$("#productForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id          = $("#pId").value;
  const name        = $("#pName").value.trim();
  const description = $("#pDescription").value.trim();
  const imageUrl    = $("#pImageUrl").value.trim();
  const categoryId  = $("#pCategory").value;
  const price       = Number($("#pPrice").value);
  const catName     = state.categories.find(c => c.id === categoryId)?.name || "";
  const downloadUrl = $("#pDownloadUrl").value.trim();

  if (!name || !imageUrl || !categoryId) return toast("Fill all required fields","error");

  const payload = {
    name, description, imageUrl, categoryId, categoryName: catName,
    developer: $("#pDeveloper").value.trim() || null,
    version:   $("#pVersion").value.trim() || null,
    platform:  $("#pPlatform").value.trim() || null,
    fileSize:  $("#pFileSize").value.trim() || null,
    tags: $("#pTags").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 15),
    price,
    originalPrice: Number($("#pOriginalPrice").value || 0),
    features: $("#pFeatures").value.split(/\s*\n\s*/).filter(Boolean).slice(0, 20),
    requirements: $("#pRequirements").value.trim() || null,
    changelog: $("#pChangelog").value.trim() || null,
    screenshotUrls: $("#pScreenshots").value.split(/\s*\n\s*/).filter(Boolean).slice(0, 12),
    seoTitle: $("#pSeoTitle").value.trim() || null,
    seoDescription: $("#pSeoDescription").value.trim() || null,
    featured:  $("#pFeatured").checked,
    available: $("#pAvailable").checked,
    updatedAt: serverTimestamp()
  };

  const btn = $("#saveProductBtn"); const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;

  try {
    let productId = id;
    if (id) {
      await updateDoc(doc(db, "products", id), payload);
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, "products"), payload);
      productId = ref.id;
    }
    if (downloadUrl) {
      await setDoc(doc(db, "products", productId, "private", "access"),
        { downloadUrl, updatedAt: serverTimestamp() }, { merge: true });
    }
    toast("Product saved", "success");
    closeM("productModal");
    loadProducts();
  } catch (err) {
    console.error(err);
    toast(err.message, "error");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
});

/* ═══ ORDER DETAIL ═══ */
function showOrderDetail(o) {
  const items = (o.items||[])
    .map(i => `<div class="order-line"><span>${esc(i.name)} × ${i.qty}</span>
      <span>${money((i.price||0) * i.qty)}</span></div>`).join("");
  const statusOpts = ORDER_STATUSES
    .map(s => `<option value="${s.value}" ${o.status===s.value?"selected":""}>${s.label}</option>`)
    .join("");

  $("#orderDetailBody").innerHTML = `
    <h3 class="modal-title"><i class="fa-solid fa-receipt"></i> Order Details</h3>
    <div class="detail-row"><span>ID</span><span style="font-size:0.7rem">${esc(o.id)}</span></div>
    <div class="detail-row"><span>Customer</span><span>${esc(o.customerName||"—")}</span></div>
    <div class="detail-row"><span>Phone</span><span>${esc(o.contactNumber||"—")}</span></div>
    <div class="detail-row"><span>Payment</span><span>${esc(o.paymentMethod||"—")}
      ${o.transactionReference ? `(${esc(o.transactionReference)})` : ""}</span></div>
    <h4 style="margin:14px 0 8px">Items</h4>
    ${items}
    <div class="order-total"><span>Total</span><span>${money(o.total)}</span></div>
    <div class="field" style="margin-top:14px">
      <label>Update Status</label>
      <select id="orderStatusSelect">${statusOpts}</select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="orderDetailModal">Close</button>
      <button class="btn btn-primary" id="saveOrderStatusBtn">
        <i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>`;
  openM("orderDetailModal");

  $("#saveOrderStatusBtn").onclick = async () => {
    const newStatus = $("#orderStatusSelect").value;
    const btn = $("#saveOrderStatusBtn"); const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    try {
      await updateDoc(doc(db, "orders", o.id), {
        status: newStatus, updatedAt: serverTimestamp()
      });
      addDoc(collection(db, "auditLogs"), {
        action: "order_status_update", orderId: o.id,
        from: o.status || "pending", to: newStatus,
        actor: auth.currentUser?.uid || "unknown",
        at: serverTimestamp()
      }).catch(() => {});
      toast("Status updated", "success");
      closeM("orderDetailModal");
      loadOrders();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      btn.disabled = false; btn.innerHTML = orig;
    }
  };
}

/* ═══ Filters ═══ */
$("#productSearch")?.addEventListener("input", renderProducts);
$("#orderSearch")?.addEventListener("input", renderOrders);
$("#orderStatusFilter")?.addEventListener("change", renderOrders);

/* ═══ Init ═══ */
function initApp() {
  loadCategories();
  loadDashboard();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { openM("loginModal"); return; }
  const ok = await checkAdmin(user.uid);
  if (!ok) {
    $("#loginErr").hidden = false;
    $("#loginErr").innerHTML = `<i class="fa-solid fa-lock"></i>
      <div><strong>Not an admin.</strong> If you're the first admin, click "Claim admin access".</div>`;
    openM("loginModal"); return;
  }
  state.user = user; state.isAdmin = true;
  $("#adminEmail").textContent = user.email || "";
  closeM("loginModal");
  initApp();
});
