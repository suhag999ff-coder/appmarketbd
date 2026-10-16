/* admin.js — dashboard overview */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import "./admin-auth.js";

const $ = (s) => document.querySelector(s);

function statCard(label, value, icon) {
  const c = document.createElement("div");
  c.className = "stat-card";
  c.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span><i class="fa-solid ${icon} stat-icon"></i>`;
  return c;
}

async function loadStats() {
  const grid = $("#statGrid");
  grid.innerHTML = "";
  try {
    const [pSnap, oSnap, uSnap] = await Promise.all([
      getDocs(collection(db, "products")),
      getDocs(collection(db, "orders")),
      getDocs(collection(db, "users")).catch(() => ({ size: null, docs: [] }))
    ]);
    const products = pSnap.docs.map(d => d.data());
    const orders = oSnap.docs.map(d => d.data());

    const totalProducts = products.length;
    const available = products.filter(p => p.available === true).length;
    const totalOrders = orders.length;
    const pending = orders.filter(o => o.status === "pending").length;
    const completed = orders.filter(o => o.status === "completed").length;

    grid.append(
      statCard("Total products", totalProducts, "fa-box"),
      statCard("Available products", available, "fa-circle-check"),
      statCard("Total orders", totalOrders, "fa-receipt"),
      statCard("Pending orders", pending, "fa-hourglass-half"),
      statCard("Completed orders", completed, "fa-flag-checkered")
    );

    // Recent orders panel
    const recent = orders
      .map((o, i) => ({ id: oSnap.docs[i].id, ...o }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 6);
    const ro = $("#recentOrders");
    ro.innerHTML = "";
    if (!recent.length) {
      ro.innerHTML = `<div class="empty-state"><i class="fa-regular fa-receipt"></i><h3>No orders yet</h3><p>Orders will appear here.</p></div>`;
    } else {
      const ul = document.createElement("ul"); ul.className = "order-items";
      recent.forEach(o => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${(o.customerName || "Customer").replace(/</g,"&lt;")}</span>
          <span class="status status-${o.status || "pending"}">${o.status || "pending"}</span>`;
        ul.appendChild(li);
      });
      ro.appendChild(ul);
    }

    // Low stock / unavailable
    const low = products.filter(p => p.available === false).slice(0, 8);
    const ls = $("#lowStock");
    ls.innerHTML = "";
    if (!low.length) {
      ls.innerHTML = `<div class="empty-state"><i class="fa-regular fa-face-smile"></i><h3>All good</h3><p>Every product is currently available.</p></div>`;
    } else {
      const ul = document.createElement("ul"); ul.className = "order-items";
      low.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${(p.name || "").replace(/</g,"&lt;")}</span><span class="tag danger">Unavailable</span>`;
        ul.appendChild(li);
      });
      ls.appendChild(ul);
    }
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div class="alert alert-danger"><i class="fa-solid fa-triangle-exclamation"></i><div>Failed to load statistics. Check Firestore rules.</div></div>`;
  }
}

const dateEl = document.getElementById("adminDate");
if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// Sidebar toggle
const toggle = document.getElementById("adminMenuToggle");
const sidebar = document.getElementById("adminSidebar");
toggle?.addEventListener("click", () => sidebar.classList.toggle("open"));

onAuthStateChanged(auth, (u) => { if (u) loadStats(); });