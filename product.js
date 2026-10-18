/* product.js — Public product detail page */
import { db } from "./firebase-config.js";
import { doc, getDoc, collection, query, where, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const PH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 250'><rect width='100%' height='100%' fill='#eef2ff'/><text x='50%' y='53%' font-family='sans-serif' font-size='22' fill='#4f46e5' text-anchor='middle' font-weight='700'>AppVerse</text></svg>`);
const money = (n) => (Number(n)||0) > 0 ? "৳" + Number(n).toLocaleString("en-BD") : "Free";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const safeUrl = (u) => {
  if (typeof u !== "string") return "";
  try { const x = new URL(u); return ["http:","https:"].includes(x.protocol) ? x.href : ""; }
  catch { return ""; }
};

const CART_KEY = "av_cart_v1";
function addToCart(p, qty = 1) {
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch {}
  if (!Array.isArray(cart)) cart = [];
  const ex = cart.find(i => i.id === p.id);
  if (ex) ex.qty = Math.min(ex.qty + qty, 20);
  else cart.push({ id: p.id, name: p.name, price: Number(p.price)||0, imageUrl: p.imageUrl, qty });
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  toast("Added to cart", "success", p.name);
}
function toast(msg, type = "info", title) {
  const stack = $("#toasts"); if (!stack) return;
  const icons = { info:"fa-circle-info", success:"fa-circle-check", error:"fa-circle-exclamation" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i>
    <div class="toast-body">${title ? `<strong>${esc(title)}</strong>` : ""}${esc(msg)}</div>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 260); }, 4000);
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  const body = $("#pdBody");
  if (!id) { body.innerHTML = `<div class="alert alert-danger">Product ID missing.</div>`; return; }

  try {
    const snap = await getDoc(doc(db, "products", id));
    if (!snap.exists()) { body.innerHTML = `<div class="alert alert-danger">Product not found.</div>`; return; }
    const p = { id: snap.id, ...snap.data() };
    document.title = (p.seoTitle || p.name || "App") + " · AppVerse";

    const price = Number(p.price) || 0;
    const orig  = Number(p.originalPrice) || 0;
    const disc  = orig > price && price > 0 ? Math.round((1 - price/orig) * 100) : 0;
    const shots = Array.isArray(p.screenshotUrls) ? p.screenshotUrls.filter(safeUrl) : [];

    // Related (same category)
    let related = [];
    if (p.categoryId) {
      try {
        const rq = await getDocs(query(collection(db,"products"),
          where("categoryId","==",p.categoryId), where("available","==",true), limit(6)));
        related = rq.docs.map(d => ({id:d.id, ...d.data()})).filter(x => x.id !== p.id).slice(0,4);
      } catch {}
    }

    body.innerHTML = `
      <div class="pd-grid">
        <div class="pd-gallery">
          <img class="pd-main" src="${safeUrl(p.imageUrl) || PH}" onerror="this.src='${PH}'" alt="">
          ${shots.length ? `<div class="pd-thumbs">
            ${shots.map((s,i) => `<img src="${safeUrl(s)}" data-shot="${i}" class="pd-thumb" alt="">`).join("")}
          </div>` : ""}
        </div>
        <div class="pd-info">
          ${p.categoryName ? `<span class="product-cat">${esc(p.categoryName)}</span>` : ""}
          <h1>${esc(p.name)}</h1>
          ${p.developer ? `<p class="muted small"><i class="fa-solid fa-code"></i> ${esc(p.developer)}</p>` : ""}
          <div class="pd-price-row">
            <span class="${price > 0 ? "price-now" : "price-free"}" style="font-size:1.6rem">${money(price)}</span>
            ${orig > price ? `<span class="price-old">${money(orig)}</span><span class="pd-discount">-${disc}%</span>` : ""}
          </div>
          <div class="pd-meta">
            ${p.version ? `<div><span>Version</span><strong>${esc(p.version)}</strong></div>` : ""}
            ${p.platform ? `<div><span>Platform</span><strong>${esc(p.platform)}</strong></div>` : ""}
            ${p.fileSize ? `<div><span>Size</span><strong>${esc(p.fileSize)}</strong></div>` : ""}
            ${p.updatedAt ? `<div><span>Updated</span><strong>${new Date(p.updatedAt.seconds*1000).toLocaleDateString()}</strong></div>` : ""}
            <div><span>Availability</span><strong>${p.available === false ? "Unavailable" : "Available"}</strong></div>
          </div>
          <button class="btn btn-primary btn-block btn-lg" id="pdBuy" ${p.available === false ? "disabled" : ""}>
            <i class="fa-solid fa-cart-plus"></i> ${price > 0 ? "Buy Now" : "Get App"}
          </button>
        </div>
      </div>

      ${p.description ? `<section class="panel" style="margin-top:20px"><div class="panel-head"><h2><i class="fa-solid fa-align-left"></i> Description</h2></div>
        <div class="panel-body"><p class="detail-desc">${esc(p.description)}</p></div></section>` : ""}

      ${Array.isArray(p.features) && p.features.length ? `<section class="panel" style="margin-top:14px">
        <div class="panel-head"><h2><i class="fa-solid fa-list-check"></i> Features</h2></div>
        <div class="panel-body"><ul class="pd-list">${p.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul></div></section>` : ""}

      ${p.requirements ? `<section class="panel" style="margin-top:14px">
        <div class="panel-head"><h2><i class="fa-solid fa-circle-info"></i> Requirements</h2></div>
        <div class="panel-body"><p class="detail-desc">${esc(p.requirements)}</p></div></section>` : ""}

      ${p.changelog ? `<section class="panel" style="margin-top:14px">
        <div class="panel-head"><h2><i class="fa-solid fa-clock-rotate-left"></i> Changelog</h2></div>
        <div class="panel-body"><p class="detail-desc">${esc(p.changelog)}</p></div></section>` : ""}

      ${related.length ? `<section class="section" style="margin-top:20px">
        <div class="section-head"><h2><i class="fa-solid fa-layer-group"></i> Related apps</h2></div>
        <div class="product-grid" id="pdRelated"></div></section>` : ""}
    `;

    // Wire up buy button
    $("#pdBuy")?.addEventListener("click", () => {
      addToCart(p);
      setTimeout(() => location.href = "index.html", 400);
    });

    // Thumbnail switching
    document.querySelectorAll(".pd-thumb").forEach(t => {
      t.addEventListener("click", () => {
        const idx = Number(t.dataset.shot);
        const main = document.querySelector(".pd-main");
        if (main && shots[idx]) main.src = safeUrl(shots[idx]) || PH;
      });
    });

    // Related cards
    if (related.length) {
      const grid = $("#pdRelated");
      related.forEach(r => {
        const price = Number(r.price)||0;
        const card = document.createElement("article");
        card.className = "product-card";
        card.innerHTML = `
          <a href="product.html?id=${encodeURIComponent(r.id)}" style="display:block;color:inherit">
            <div class="product-media"><img src="${safeUrl(r.imageUrl)||PH}" onerror="this.src='${PH}'" loading="lazy"></div>
            <div class="product-body">
              <h3 class="product-name">${esc(r.name)}</h3>
              <div class="product-price"><span class="${price>0?"price-now":"price-free"}">${money(price)}</span></div>
            </div>
          </a>`;
        grid.appendChild(card);
      });
    }

    // Update meta description
    const md = document.createElement("meta");
    md.name = "description";
    md.content = (p.seoDescription || (p.description || "").slice(0, 160));
    document.head.appendChild(md);

  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="alert alert-danger">Failed to load product.</div>`;
  }
}
init();
