/* admin-orders.js — order list, search, filter, status updates */
import { auth, db, functions } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, getDocs, doc, updateDoc, serverTimestamp, orderBy, query
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
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

let allOrders = [];

async function loadOrders() {
  try {
    const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  } catch (err) {
    console.error(err);
    toast("Failed to load orders.", "error");
  }
}

function render() {
  const term = ($("#adminOrderSearch")?.value || "").trim().toLowerCase();
  const status = $("#adminOrderStatus")?.value || "";
  let items = allOrders;
  if (status) items = items.filter(o => o.status === status);
  if (term) items = items.filter(o =>
    (o.customerName || "").toLowerCase().includes(term) ||
    (o.contactNumber || "").toLowerCase().includes(term) ||
    (o.id || "").toLowerCase().includes(term));

  const tb = $("#ordersTbody"); tb.replaceChildren();
  if (!items.length) {
    tb.appendChild(Object.assign(document.createElement("tr"), {
      innerHTML: `<td colspan="8"><div class="empty-state"><i class="fa-regular fa-receipt"></i><h3>No orders</h3><p>No matching orders found.</p></div></td>`
    }));
  } else items.forEach(o => {
    const tr = document.createElement("tr");
    tr.append(
      Object.assign(document.createElement("td"), { textContent: o.id.slice(0, 8) + "…" }),
      Object.assign(document.createElement("td"), { textContent: o.customerName || "—" }),
      Object.assign(document.createElement("td"), { textContent: String((o.items || []).length) }),
      Object.assign(document.createElement("td"), { textContent: "৳" + (Number(o.total) || 0).toLocaleString() }),
      Object.assign(document.createElement("td"), { textContent: o.paymentMethod || "—" }),
      Object.assign(document.createElement("td"), { innerHTML: `<span class="status status-${o.status}">${o.status}</span>` }),
      Object.assign(document.createElement("td"), { textContent: (o.createdAt?.toDate?.() || new Date()).toLocaleDateString() })
    );
    const tdA = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost btn-sm"; btn.textContent = "View";
    btn.addEventListener("click", () => openOrder(o));
    tdA.appendChild(btn); tr.appendChild(tdA);
    tb.appendChild(tr);
  });

  // mobile
  const cards = $("#ordersCards"); cards.replaceChildren();
  items.forEach(o => {
    const c = document.createElement("div"); c.className = "admin-card";
    c.innerHTML = `<div class="row-top"><div><strong>${(o.customerName || "").replace(/</g,"&lt;")}</strong>
      <div class="muted small">${o.contactNumber || ""}</div></div>
      <span class="spacer"></span><span class="status status-${o.status}">${o.status}</span></div>
      <div>Total: <strong>৳${(Number(o.total)||0).toLocaleString()}</strong></div>`;
    const b = document.createElement("button"); b.className = "btn btn-ghost btn-sm"; b.textContent = "View details";
    b.onclick = () => openOrder(o);
    c.appendChild(b);
    cards.appendChild(c);
  });
}

function openOrder(o) {
  const host = $("#orderDetail");
  const items = o.items || [];
  const itemsHtml = items.map(it =>
    `<li><span>${(it.name || "").replace(/</g,"&lt;")} × ${it.qty}</span><span>৳${((Number(it.price)||0) * it.qty).toLocaleString()}</span></li>`
  ).join("");

  host.innerHTML = `
    <div class="stack">
      <div class="row">
        <span class="order-id">Order ${o.id}</span>
        <span class="spacer"></span>
        <span class="status status-${o.status}">${o.status}</span>
      </div>
      <div class="detail-meta">
        <div class="row"><span>Customer</span><span>${(o.customerName||"").replace(/</g,"&lt;")}</span></div>
        <div class="row"><span>Contact</span><span>${(o.contactNumber||"").replace(/</g,"&lt;")}</span></div>
        <div class="row"><span>Payment</span><span>${(o.paymentMethod||"").replace(/</g,"&lt;")}</span></div>
        <div class="row"><span>Reference</span><span>${(o.transactionReference||"—").replace(/</g,"&lt;")}</span></div>
        <div class="row"><span>Created</span><span>${(o.createdAt?.toDate?.() || new Date()).toLocaleString()}</span></div>
      </div>
      <h4 style="margin:8px 0 0">Items</h4>
      <ul class="order-items">${itemsHtml}</ul>
      <div class="row"><strong>Total (authoritative)</strong><span class="spacer"></span><strong>৳${(Number(o.total)||0).toLocaleString()}</strong></div>
      ${o.note ? `<div class="alert alert-info"><i class="fa-solid fa-note-sticky"></i><div>${(o.note).replace(/</g,"&lt;")}</div></div>` : ""}
      <div class="field">
        <label>Update status</label>
        <select id="statusSelect" class="select">
          <option value="pending"${o.status==="pending"?" selected":""}>Pending</option>
          <option value="confirmed"${o.status==="confirmed"?" selected":""}>Confirmed</option>
          <option value="completed"${o.status==="completed"?" selected":""}>Completed</option>
          <option value="cancelled"${o.status==="cancelled"?" selected":""}>Cancelled</option>
        </select>
      </div>
      <div class="row"><span class="spacer"></span>
        <button class="btn btn-primary" id="saveStatusBtn"><i class="fa-solid fa-floppy-disk"></i> Save status</button>
      </div>
    </div>`;

  $("#orderModal").hidden = false;
  document.body.style.overflow = "hidden";
  $("#saveStatusBtn").addEventListener("click", async () => {
    const next = $("#statusSelect").value;
    const btn = $("#saveStatusBtn"); const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    try {
      // Prefer Cloud Function so Telegram notification fires.
      try {
        const update = httpsCallable(functions, "updateOrderStatus");
        await update({ orderId: o.id, status: next });
      } catch (fnErr) {
        // Fallback: direct admin write (rules permit admins to update status only)
        await updateDoc(doc(db, "orders", o.id), { status: next, updatedAt: serverTimestamp() });
      }
      toast("Status updated.", "success");
      $("#orderModal").hidden = true;
      document.body.style.overflow = "";
      await loadOrders();
    } catch (err) {
      console.error(err);
      toast(err?.message || "Update failed.", "error");
    } finally {
      btn.disabled = false; btn.innerHTML = orig;
    }
  });
}

document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) {
    const id = c.getAttribute("data-close");
    if (id === "orderModal") { $("#orderModal").hidden = true; document.body.style.overflow = ""; }
    else document.getElementById(id).hidden = true;
  }
});
$("#adminOrderSearch")?.addEventListener("input", render);
$("#adminOrderStatus")?.addEventListener("change", render);

const toggle = document.getElementById("adminMenuToggle");
const sidebar = document.getElementById("adminSidebar");
toggle?.addEventListener("click", () => sidebar.classList.toggle("open"));

onAuthStateChanged(auth, (u) => { if (u) loadOrders(); });