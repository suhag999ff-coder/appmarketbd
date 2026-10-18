/* admin.js — Professional Admin Logic */
import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);

// Mobile Sidebar Toggle
$("#menuBtn").onclick = () => $("#adminSidebar").classList.toggle("open");

// Navigation
document.querySelectorAll(".admin-nav button[data-view]").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".admin-nav button").forEach(b => b.classList.remove("active")); btn.classList.add("active");
    document.querySelectorAll("section[data-view]").forEach(s => s.hidden = s.dataset.view !== btn.dataset.view);
    $("#pageTitle").textContent = btn.textContent.trim();
    if(btn.dataset.view === 'dashboard') loadDashboard();
    if(btn.dataset.view === 'orders') loadAdminOrders();
    if(btn.dataset.view === 'users') loadAdminUsers();
  };
});

// Auth Check (Simplified for demo)
onAuthStateChanged(auth, async (u) => {
  if (!u) { alert("Please login from index page first"); location.href="login.html"; return; }
  loadDashboard();
});

$("#adminLogout").onclick = () => signOut(auth).then(() => location.href="index.html");

// Load Dashboard Stats
async function loadDashboard() {
  const [p, o, u] = await Promise.all([ getDocs(collection(db, "products")), getDocs(collection(db, "orders")), getDocs(collection(db, "users")) ]);
  $("#statGrid").innerHTML = `
    <div class="stat-card"><span class="stat-value">${p.size}</span><span class="stat-label">Products</span></div>
    <div class="stat-card"><span class="stat-value">${o.size}</span><span class="stat-label">Orders</span></div>
    <div class="stat-card"><span class="stat-value">${u.size}</span><span class="stat-label">Users</span></div>
    <div class="stat-card"><span class="stat-value">৳0</span><span class="stat-label">Revenue</span></div>
  `;

  const qOrders = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  const snap = await getDocs(qOrders);
  $("#recentOrders").innerHTML = snap.docs.slice(0,5).map(d => {
    const o = d.data();
    return `<div class="admin-item"><div class="admin-item-info"><strong>${o.customerName}</strong><div>৳${o.total} · ${o.status}</div></div></div>`;
  }).join("");
}

// Load Orders
async function loadAdminOrders() {
  const snap = await getDocs(collection(db, "orders"));
  $("#adminOrdersList").innerHTML = snap.docs.map(d => {
    const o = d.data();
    return `<div class="admin-item"><div class="admin-item-info"><strong>${o.customerName}</strong><div>${o.contactNumber} · ৳${o.total}</div></div><span class="chip">${o.status}</span></div>`;
  }).join("");
}

// Load Users
async function loadAdminUsers() {
  const snap = await getDocs(collection(db, "users"));
  $("#adminUsersList").innerHTML = snap.docs.map(d => {
    const u = d.data();
    return `<div class="admin-item"><div class="admin-item-info"><strong>${u.displayName}</strong><div>${u.email} · Balance: ৳${u.balance||0}</div></div></div>`;
  }).join("");
}
