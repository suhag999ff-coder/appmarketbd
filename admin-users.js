/* admin-users.js — view registered users */
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import "./admin-auth.js";

const $ = (s) => document.querySelector(s);
let allUsers = [];

async function loadUsers() {
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  } catch (err) {
    console.error(err);
  }
}
function render() {
  const term = ($("#adminUserSearch")?.value || "").toLowerCase();
  const items = !term ? allUsers : allUsers.filter(u =>
    (u.displayName || "").toLowerCase().includes(term) ||
    (u.email || "").toLowerCase().includes(term));
  const tb = $("#usersTbody"); tb.replaceChildren();
  if (!items.length) {
    tb.appendChild(Object.assign(document.createElement("tr"), {
      innerHTML: `<td colspan="5"><div class="empty-state"><i class="fa-regular fa-users"></i><h3>No users</h3><p>Registered users appear here.</p></div></td>`
    }));
  } else items.forEach(u => {
    const tr = document.createElement("tr");
    tr.append(
      Object.assign(document.createElement("td"), { textContent: u.displayName || "—" }),
      Object.assign(document.createElement("td"), { textContent: u.email || "—" }),
      Object.assign(document.createElement("td"), { innerHTML: u.isAdmin ? `<span class="tag primary">Yes</span>` : `<span class="tag">No</span>` }),
      Object.assign(document.createElement("td"), { textContent: (u.createdAt?.toDate?.() || new Date()).toLocaleDateString() }),
      Object.assign(document.createElement("td"), {})
    );
    tb.appendChild(tr);
  });

  const cards = $("#usersCards"); cards.replaceChildren();
  items.forEach(u => {
    const c = document.createElement("div"); c.className = "admin-card";
    c.innerHTML = `<strong>${(u.displayName || "").replace(/</g,"&lt;")}</strong>
      <div class="muted small">${(u.email||"").replace(/</g,"&lt;")}</div>
      <div class="muted small">Joined ${(u.createdAt?.toDate?.() || new Date()).toLocaleDateString()}</div>`;
    cards.appendChild(c);
  });
}
$("#adminUserSearch")?.addEventListener("input", render);
const toggle = document.getElementById("adminMenuToggle");
const sidebar = document.getElementById("adminSidebar");
toggle?.addEventListener("click", () => sidebar.classList.toggle("open"));
onAuthStateChanged(auth, (u) => { if (u) loadUsers(); });