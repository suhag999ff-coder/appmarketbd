/* admin-settings.js — settings form + categories CRUD (page-detected) */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, getDocs, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, orderBy, query
} from "firebase/firestore";
import "./admin-auth.js";

const $ = (s) => document.querySelector(s);

function toast(m, t = "info", title) {
  const s = $("#toasts"); if (!s) return;
  const ic = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation" };
  const n = document.createElement("div"); n.className = `toast ${t}`;
  n.innerHTML = `<i class="fa-solid ${ic[t]}"></i><div class="toast-body">${title ? `<strong>${title}</strong>` : ""}${m.replace(/</g,"&lt;")}</div>`;
  s.appendChild(n);
  setTimeout(() => { n.style.opacity = "0"; setTimeout(() => n.remove(), 250); }, 4200);
}

/* ============ Settings page ============ */
if ($("#settingsForm")) {
  (async function initSettings() {
    try {
      const snap = await getDoc(doc(db, "settings", "public"));
      const s = snap.exists() ? snap.data() : {};
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ""; };
      set("sStoreName", s.storeName || "AppVerse");
      set("sContactEmail", s.contactEmail || "");
      set("sContactPhone", s.contactPhone || "");
      set("sBkash", s.bkashNumber || "");
      set("sNagad", s.nagadNumber || "");
      set("sRocket", s.rocketNumber || "");
      set("sTelegramChat", s.telegramChatId || "-1004322135682");
    } catch (err) { console.error(err); }
  })();

  $("#settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || $("#settingsForm button[type=submit]");
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving…`;
    try {
      await setDoc(doc(db, "settings", "public"), {
        storeName: $("#sStoreName").value.trim(),
        contactEmail: $("#sContactEmail").value.trim(),
        contactPhone: $("#sContactPhone").value.trim(),
        bkashNumber: $("#sBkash").value.trim(),
        nagadNumber: $("#sNagad").value.trim(),
        rocketNumber: $("#sRocket").value.trim(),
        telegramChatId: $("#sTelegramChat").value.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast("Settings saved.", "success");
    } catch (err) { toast(err?.message || "Save failed.", "error"); }
    finally { btn.disabled = false; btn.innerHTML = orig; }
  });
}

/* ============ Categories page ============ */
if ($("#catsTbody")) {
  let cats = [];
  async function loadCats() {
    const snap = await getDocs(query(collection(db, "categories"), orderBy("createdAt", "desc")));
    cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCats();
  }
  function renderCats() {
    const tb = $("#catsTbody"); tb.replaceChildren();
    if (!cats.length) {
      tb.appendChild(Object.assign(document.createElement("tr"), {
        innerHTML: `<td colspan="5"><div class="empty-state"><i class="fa-regular fa-tag"></i><h3>No categories</h3><p>Add your first category.</p></div></td>`
      }));
    } else cats.forEach(c => {
      const tr = document.createElement("tr");
      tr.append(
        Object.assign(document.createElement("td"), { textContent: c.name }),
        Object.assign(document.createElement("td"), { textContent: c.slug }),
        Object.assign(document.createElement("td"), { innerHTML: c.active ? `<span class="tag success">Yes</span>` : `<span class="tag">No</span>` }),
        Object.assign(document.createElement("td"), { textContent: (c.createdAt?.toDate?.() || new Date()).toLocaleDateString() })
      );
      const td = document.createElement("td");
      const acts = document.createElement("div"); acts.className = "row-actions";
      const eb = document.createElement("button"); eb.innerHTML = `<i class="fa-solid fa-pen"></i>`;
      eb.onclick = () => openCat(c);
      const db_ = document.createElement("button"); db_.className = "danger"; db_.innerHTML = `<i class="fa-solid fa-trash"></i>`;
      db_.onclick = () => delCat(c);
      acts.append(eb, db_); td.appendChild(acts); tr.appendChild(td);
      tb.appendChild(tr);
    });

    const cards = $("#catsCards"); cards.replaceChildren();
    cats.forEach(c => {
      const card = document.createElement("div"); card.className = "admin-card";
      card.innerHTML = `<strong>${(c.name||"").replace(/</g,"&lt;")}</strong><div class="muted small">${c.slug}</div>`;
      const acts = document.createElement("div"); acts.className = "row-actions";
      const eb = document.createElement("button"); eb.textContent = "Edit"; eb.onclick = () => openCat(c);
      const db_ = document.createElement("button"); db_.className = "danger"; db_.textContent = "Delete"; db_.onclick = () => delCat(c);
      acts.append(eb, db_); card.appendChild(acts);
      cards.appendChild(card);
    });
  }
  function openCat(c = null) {
    $("#categoryModal").hidden = false;
    $("#categoryModalTitle").innerHTML = `<i class="fa-solid fa-tag"></i> ${c ? "Edit" : "New"} category`;
    $("#cId").value = c?.id || "";
    $("#cName").value = c?.name || "";
    $("#cSlug").value = c?.slug || "";
    $("#cActive").checked = c ? c.active !== false : true;
  }
  async function saveCat(e) {
    e.preventDefault();
    const id = $("#cId").value;
    const name = $("#cName").value.trim();
    const slug = $("#cSlug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!name || !slug) { toast("Name and slug required.", "error"); return; }
    const payload = { name, slug, active: $("#cActive").checked, updatedAt: serverTimestamp() };
    try {
      if (id) await updateDoc(doc(db, "categories", id), payload);
      else { payload.createdAt = serverTimestamp(); await addDoc(collection(db, "categories"), payload); }
      toast("Category saved.", "success");
      $("#categoryModal").hidden = true;
      await loadCats();
    } catch (err) { toast(err?.message || "Save failed.", "error"); }
  }
  function delCat(c) {
    $("#confirmTitle").textContent = "Delete category?";
    $("#confirmMessage").textContent = `"${c.name}" will be removed. Products using it will remain but display no category.`;
    $("#confirmModal").hidden = false;
    const done = async (ok) => {
      $("#confirmModal").hidden = true;
      $("#confirmOk").removeEventListener("click", onOk);
      $("#confirmCancel").removeEventListener("click", onCancel);
      if (!ok) return;
      try { await deleteDoc(doc(db, "categories", c.id)); toast("Category deleted.", "success"); await loadCats(); }
      catch (err) { toast(err?.message || "Delete failed.", "error"); }
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    $("#confirmOk").addEventListener("click", onOk);
    $("#confirmCancel").addEventListener("click", onCancel);
  }

  $("#newCategoryBtn")?.addEventListener("click", () => openCat(null));
  $("#categoryForm")?.addEventListener("submit", saveCat);
  onAuthStateChanged(auth, (u) => { if (u) loadCats(); });
}

/* shared */
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) document.getElementById(c.getAttribute("data-close")).hidden = true;
});
const toggle = document.getElementById("adminMenuToggle");
const sidebar = document.getElementById("adminSidebar");
toggle?.addEventListener("click", () => sidebar.classList.toggle("open"));