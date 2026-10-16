/* admin-products.js — full product CRUD with image URL validation */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy
} from "firebase/firestore";
import "./admin-auth.js";

const $ = (s) => document.querySelector(s);
const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='55%' font-family='Inter' font-size='9' fill='#4f46e5' text-anchor='middle'>N/A</text></svg>`);

function toast(m, t = "info", title) {
  const s = $("#toasts"); if (!s) return;
  const ic = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation" };
  const n = document.createElement("div");
  n.className = `toast ${t}`;
  n.innerHTML = `<i class="fa-solid ${ic[t]}"></i><div class="toast-body">${title ? `<strong>${title}</strong>` : ""}${m.replace(/</g,"&lt;")}</div>`;
  s.appendChild(n);
  setTimeout(() => { n.style.opacity = "0"; setTimeout(() => n.remove(), 250); }, 4200);
}
function safeUrl(u) {
  if (typeof u !== "string") return "";
  try { const url = new URL(u); return (url.protocol === "http:" || url.protocol === "https:") ? url.href : ""; } catch { return ""; }
}
function val(id) { return document.getElementById(id).value.trim(); }
function chk(id) { return document.getElementById(id).checked; }
function setVal(id, v) { document.getElementById(id).value = v ?? ""; }
function setChk(id, v) { document.getElementById(id).checked = !!v; }

let categories = [];
let allProducts = [];

async function loadCategories() {
  const snap = await getDocs(collection(db, "categories"));
  categories = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const sel = $("#pCategory");
  if (sel) {
    sel.replaceChildren(new Option("Select category…", ""));
    categories.forEach(c => sel.appendChild(new Option(c.name, c.id)));
  }
}

function catName(id) {
  const c = categories.find(x => x.id === id);
  return c ? c.name : "—";
}

async function loadProducts() {
  try {
    const snap = await getDocs(query(collection(db, "products"), orderBy("createdAt", "desc")));
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  } catch (err) {
    console.error(err);
    toast("Failed to load products.", "error");
  }
}

function render() {
  const term = ($("#adminProductSearch")?.value || "").trim().toLowerCase();
  const items = !term ? allProducts : allProducts.filter(p =>
    (p.name || "").toLowerCase().includes(term) ||
    (catName(p.categoryId) || "").toLowerCase().includes(term));

  // Desktop table
  const tbody = $("#productsTbody");
  tbody.replaceChildren();
  if (!items.length) {
    tbody.appendChild(Object.assign(document.createElement("tr"), {
      innerHTML: `<td colspan="7"><div class="empty-state"><i class="fa-regular fa-box"></i><h3>No products</h3><p>Click "New product" to add one.</p></div></td>`
    }));
  } else {
    items.forEach(p => {
      const tr = document.createElement("tr");
      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = "lazy";
      img.src = safeUrl(p.imageUrl) || PLACEHOLDER;
      img.onerror = () => { img.src = PLACEHOLDER; };

      const tdImg = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.style.display = "flex"; wrap.style.gap = "10px"; wrap.style.alignItems = "center";
      wrap.append(img, document.createTextNode(p.name || "Untitled"));
      tdImg.appendChild(wrap);

      tr.append(
        tdImg,
        Object.assign(document.createElement("td"), { textContent: catName(p.categoryId) }),
        Object.assign(document.createElement("td"), { textContent: Number(p.price) > 0 ? "৳" + Number(p.price).toLocaleString() : "Free" }),
        Object.assign(document.createElement("td"), { innerHTML: p.featured ? `<span class="tag primary">Yes</span>` : `<span class="tag">No</span>` }),
        Object.assign(document.createElement("td"), { innerHTML: p.available ? `<span class="tag success">Yes</span>` : `<span class="tag danger">No</span>` }),
        Object.assign(document.createElement("td"), { textContent: (p.updatedAt?.toDate?.() || new Date()).toLocaleDateString() })
      );

      const tdA = document.createElement("td");
      const acts = document.createElement("div"); acts.className = "row-actions";
      const eb = document.createElement("button"); eb.innerHTML = `<i class="fa-solid fa-pen"></i>`; eb.title = "Edit";
      eb.addEventListener("click", () => openEditor(p));
      const db_ = document.createElement("button"); db_.className = "danger"; db_.innerHTML = `<i class="fa-solid fa-trash"></i>`; db_.title = "Delete";
      db_.addEventListener("click", () => confirmDelete(p));
      acts.append(eb, db_);
      tdA.appendChild(acts);
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    });
  }

  // Mobile cards
  const cards = $("#productsCards");
  cards.replaceChildren();
  items.forEach(p => {
    const c = document.createElement("div"); c.className = "admin-card";
    const row = document.createElement("div"); row.className = "row-top";
    const img = document.createElement("img"); img.src = safeUrl(p.imageUrl) || PLACEHOLDER; img.onerror = () => img.src = PLACEHOLDER;
    const info = document.createElement("div");
    info.innerHTML = `<strong>${(p.name || "Untitled").replace(/</g,"&lt;")}</strong><div class="muted small">${catName(p.categoryId)} · ${Number(p.price) > 0 ? "৳" + Number(p.price).toLocaleString() : "Free"}</div>`;
    row.append(img, info);
    c.appendChild(row);
    const acts = document.createElement("div"); acts.className = "row-actions";
    const eb = document.createElement("button"); eb.textContent = "Edit";
    eb.onclick = () => openEditor(p);
    const db_ = document.createElement("button"); db_.className = "danger"; db_.textContent = "Delete";
    db_.onclick = () => confirmDelete(p);
    acts.append(eb, db_);
    c.appendChild(acts);
    cards.appendChild(c);
  });
}

function openEditor(p = null) {
  const modal = $("#productModal");
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  $("#productModalTitle").innerHTML = p ? `<i class="fa-solid fa-box"></i> Edit product` : `<i class="fa-solid fa-box"></i> New product`;
  setVal("pId", p?.id || "");
  setVal("pName", p?.name || "");
  setVal("pDescription", p?.description || "");
  setVal("pImageUrl", p?.imageUrl || "");
  setVal("pVersion", p?.version || "");
  setVal("pScreenshots", Array.isArray(p?.screenshotUrls) ? p.screenshotUrls.join("\n") : "");
  setVal("pPrice", p?.price ?? "");
  setVal("pOriginalPrice", p?.originalPrice ?? "");
  setVal("pProductUrl", p?.productUrl || "");
  setChk("pFeatured", p?.featured === true);
  setChk("pAvailable", p?.available !== false);
  $("#pCategory").value = p?.categoryId || "";
}

function closeEditor() {
  $("#productModal").hidden = true;
  document.body.style.overflow = "";
  document.querySelectorAll(".error[data-error-for]").forEach(n => n.textContent = "");
}

async function saveProduct(e) {
  e.preventDefault();
  const id = val("pId");
  const name = val("pName");
  const description = val("pDescription");
  const imageUrl = val("pImageUrl");
  const categoryId = val("pCategory");
  const price = Number(val("pPrice"));
  const originalPrice = Number(val("pOriginalPrice") || 0);
  const version = val("pVersion");
  const productUrl = val("pProductUrl");
  const screenshotUrls = val("pScreenshots").split(/\s*\n\s*/).filter(Boolean).slice(0, 12);

  document.querySelectorAll(".error[data-error-for]").forEach(n => n.textContent = "");
  let ok = true;
  if (name.length < 2) { document.querySelector('[data-error-for="pName"]').textContent = "Name required."; ok = false; }
  if (!safeUrl(imageUrl)) { document.querySelector('[data-error-for="pImageUrl"]').textContent = "Must be a valid http(s) URL."; ok = false; }
  if (!categoryId) { toast("Please select a category.", "error"); ok = false; }
  if (!Number.isFinite(price) || price < 0) { toast("Price must be a non-negative number.", "error"); ok = false; }
  if (!ok) return;

  const btn = $("#saveProductBtn"); const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;

  const payload = {
    name, description, imageUrl, categoryId,
    categoryName: categories.find(c => c.id === categoryId)?.name || "",
    price, originalPrice, version, productUrl,
    screenshotUrls,
    featured: chk("pFeatured"),
    available: chk("pAvailable"),
    updatedAt: serverTimestamp(),
  };

  try {
    if (id) {
      await updateDoc(doc(db, "products", id), payload);
      toast("Product updated.", "success", "Saved");
    } else {
      payload.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), payload);
      toast("Product created.", "success", "Saved");
    }
    closeEditor();
    await loadProducts();
  } catch (err) {
    console.error(err);
    toast(err?.message || "Save failed.", "error");
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

function confirmDelete(p) {
  const modal = $("#confirmModal");
  $("#confirmTitle").textContent = "Delete product?";
  $("#confirmMessage").textContent = `"${p.name}" will be permanently deleted. This cannot be undone.`;
  modal.hidden = false;
  const done = async (ok) => {
    modal.hidden = true;
    $("#confirmOk").removeEventListener("click", onOk);
    $("#confirmCancel").removeEventListener("click", onCancel);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "products", p.id));
      toast("Product deleted.", "success");
      await loadProducts();
    } catch (err) {
      toast(err?.message || "Delete failed.", "error");
    }
  };
  const onOk = () => done(true);
  const onCancel = () => done(false);
  $("#confirmOk").addEventListener("click", onOk);
  $("#confirmCancel").addEventListener("click", onCancel);
}

// Wire up
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) {
    const id = c.getAttribute("data-close");
    if (id === "productModal") closeEditor();
    else document.getElementById(id).hidden = true;
  }
});
$("#newProductBtn")?.addEventListener("click", () => openEditor(null));
$("#productForm")?.addEventListener("submit", saveProduct);
$("#adminProductSearch")?.addEventListener("input", render);

const toggle = document.getElementById("adminMenuToggle");
const sidebar = document.getElementById("adminSidebar");
toggle?.addEventListener("click", () => sidebar.classList.toggle("open"));

onAuthStateChanged(auth, async (u) => {
  if (!u) return;
  await loadCategories();
  await loadProducts();
});