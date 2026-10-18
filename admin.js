/* admin.js — Professional Admin Panel */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const toast = (msg, type="info") => {
  const stack = $("#toasts"); if(!stack) return alert(msg);
  const el = document.createElement("div"); el.className = `toast ${type}`; el.innerHTML = `<div>${msg}</div>`;
  stack.appendChild(el); setTimeout(() => el.remove(), 3000);
};
const money = (n) => "৳" + Number(n || 0).toLocaleString("en-BD");

/* NAVIGATION */
document.querySelectorAll(".admin-nav button[data-view]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".admin-nav button[data-view]").forEach(b => b.classList.remove("active")); btn.classList.add("active");
    document.querySelectorAll(".admin-view").forEach(v => v.hidden = v.dataset.view !== btn.dataset.view);
    $("#pageTitle").textContent = btn.textContent.trim();
    if (btn.dataset.view === "dashboard") loadDashboard();
    if (btn.dataset.view === "products") loadProducts();
    if (btn.dataset.view === "orders") loadOrders();
    if (btn.dataset.view === "users") loadUsers();
    if (btn.dataset.view === "settings") loadSettings();
  };
});

/* AUTH */
onAuthStateChanged(auth, async (user) => {
  if (!user) return $("#loginModal").hidden = false;
  const snap = await getDoc(doc(db, "admins", user.uid));
  if (!snap.exists()) { await signOut(auth); return toast("Access Denied", "error"); }
  $("#loginModal").hidden = true; $("#adminEmail").textContent = user.email;
  loadDashboard();
});

$("#adminLoginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, $("#adminEmailInput").value, $("#adminPasswordInput").value); }
  catch (err) { $("#loginErr").hidden = false; $("#loginErr").textContent = err.message; }
});

$("#adminLogout")?.addEventListener("click", () => { signOut(auth); location.reload(); });

/* DASHBOARD */
async function loadDashboard() {
  const [pSnap, oSnap] = await Promise.all([getDocs(collection(db, "products")), getDocs(collection(db, "orders"))]);
  $("#statGrid").innerHTML = `
    <div class="stat-card"><span class="stat-value">${pSnap.size}</span><div class="stat-label">Total Apps</div></div>
    <div class="stat-card"><span class="stat-value">${oSnap.size}</span><div class="stat-label">Total Orders</div></div>
    <div class="stat-card"><span class="stat-value">${oSnap.docs.filter(d => d.data().status === 'pending').length}</span><div class="stat-label">Pending Orders</div></div>
  `;
  const recent = oSnap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0)).slice(0,5);
  $("#recentOrders").innerHTML = recent.map(o => `<div class="admin-item"><div class="admin-item-info"><strong>${o.customerName}</strong><div>${money(o.total)}</div></div><span class="status status-${o.status}">${o.status}</span></div>`).join("");
}

/* PRODUCTS */
async function loadProducts() {
  const snap = await getDocs(collection(db, "products"));
  $("#productsList").innerHTML = snap.docs.map(d => {
    const p = d.data();
    return `<div class="admin-item">
      <img src="${p.imageUrl || ''}">
      <div class="admin-item-info"><strong>${p.name}</strong><div>${money(p.price)}</div></div>
      <div class="admin-item-actions">
        <button onclick="deleteProduct('${d.id}')" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
  }).join("");
}
window.deleteProduct = async (id) => { if(confirm("Delete product?")) { await deleteDoc(doc(db, "products", id)); loadProducts(); } };

/* ORDERS */
async function loadOrders() {
  const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
  $("#ordersList").innerHTML = snap.docs.map(d => {
    const o = d.data();
    return `<div class="admin-item">
      <div class="admin-item-info"><strong>${o.customerName}</strong><div>${o.contactNumber} · ${money(o.total)}</div></div>
      <select onchange="updateOrder('${d.id}', this.value)" style="padding:6px;border-radius:6px;border:1px solid #ccc">
        <option value="pending" ${o.status==='pending'?'selected':''}>Pending</option>
        <option value="completed" ${o.status==='completed'?'selected':''}>Completed</option>
        <option value="cancelled" ${o.status==='cancelled'?'selected':''}>Cancelled</option>
      </select>
    </div>`;
  }).join("");
}
window.updateOrder = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); toast("Order Updated", "success"); };

/* USERS */
async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  $("#usersList").innerHTML = snap.docs.map(d => `<div class="admin-item"><div class="admin-item-info"><strong>${d.data().displayName}</strong><div>${d.data().email}</div></div></div>`).join("");
}

/* SETTINGS & TELEGRAM TEST */
async function loadSettings() {
  const snap = await getDoc(doc(db, "settings", "public"));
  if (!snap.exists()) return;
  const d = snap.data();
  $("#sStoreName").value = d.storeName || "";
  $("#sPhone").value = d.contactPhone || "";
  $("#sEmail").value = d.contactEmail || "";
  $("#sBkash").value = d.bkashNumber || "";
  $("#sNagad").value = d.nagadNumber || "";
  $("#sRocket").value = d.rocketNumber || "";
  $("#sTelegramToken").value = d.telegramToken || "";
  $("#sTelegramChat").value = d.telegramChatId || "";
}

$("#settingsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault(); const btn = e.submitter; btn.disabled = true;
  await setDoc(doc(db, "settings", "public"), {
    storeName: $("#sStoreName").value, contactPhone: $("#sPhone").value, contactEmail: $("#sEmail").value,
    bkashNumber: $("#sBkash").value, nagadNumber: $("#sNagad").value, rocketNumber: $("#sRocket").value,
    telegramToken: $("#sTelegramToken").value, telegramChatId: $("#sTelegramChat").value, updatedAt: serverTimestamp()
  }, { merge: true });
  toast("Settings Saved Successfully", "success"); btn.disabled = false;
});

// TEST TELEGRAM BUTTON LOGIC
$("#testTelegramBtn")?.addEventListener("click", async () => {
  const token = $("#sTelegramToken").value.trim(), chatId = $("#sTelegramChat").value.trim();
  if (!token || !chatId) return toast("Enter Token and Chat ID first", "error");
  const btn = $("#testTelegramBtn"); btn.innerHTML = "Sending...";
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: "✅ <b>Test Successful!</b>\nYour bot is working perfectly.", parse_mode: 'HTML' })
    });
    if (res.ok) toast("Test message sent to Telegram!", "success");
    else toast("Failed! Check Token or Chat ID.", "error");
  } catch (err) { toast("Network Error", "error"); }
  btn.innerHTML = `<i class="fa-brands fa-telegram"></i> Test Notification`;
});
