/* AppVerse Cloud Functions — Telegram + Admin Bootstrap + Download Auth */
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/* ─── Telegram helper ────────────────────────────────────── */
async function sendTelegram(text) {
  const token  = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT;
  if (!token || !chatId) {
    console.warn("Telegram env vars missing — skipping notification");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    if (!res.ok) console.error("Telegram error:", await res.text());
  } catch (err) {
    console.error("Telegram fetch failed:", err);
  }
}

const escapeHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ─── 1. NEW ORDER → Telegram ────────────────────────────── */
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const o = event.data.data();
  const items = (o.items || [])
    .map(i => `• ${escapeHtml(i.name)} × ${i.qty}`)
    .join("\n");
  const text =
    `🛒 <b>New Order</b>\n\n` +
    `<b>Order ID:</b> <code>${event.params.orderId}</code>\n` +
    `<b>Customer:</b> ${escapeHtml(o.customerName)}\n` +
    `<b>Phone:</b> ${escapeHtml(o.contactNumber)}\n` +
    `<b>Payment:</b> ${escapeHtml(o.paymentMethod)} (${escapeHtml(o.transactionReference || "N/A")})\n` +
    `<b>Total:</b> ৳${o.total}\n\n<b>Items:</b>\n${items}`;
  await sendTelegram(text);
});

/* ─── 2. ORDER STATUS CHANGE → Telegram ──────────────────── */
exports.onOrderUpdated = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  if (before.status === after.status) return;

  const emoji = {
    confirmed: "✅",
    payment_verified: "💳",
    delivered: "📦",
    cancelled: "❌",
    refunded: "↩️",
    pending: "⏳"
  }[after.status] || "🔄";

  const text =
    `${emoji} <b>Order Status Updated</b>\n\n` +
    `<b>Order:</b> <code>${event.params.orderId}</code>\n` +
    `<b>Customer:</b> ${escapeHtml(after.customerName)}\n` +
    `<b>Status:</b> ${escapeHtml(before.status)} → <b>${escapeHtml(after.status)}</b>`;
  await sendTelegram(text);
});

/* ─── 3. BOOTSTRAP ADMIN (callable) ──────────────────────── */
/* Call this from the client once, using an email listed in ADMIN_EMAILS env */
exports.bootstrapAdmin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const email = (request.auth.token.email || "").toLowerCase();
  const allowed = (process.env.ADMIN_EMAILS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

  if (!allowed.includes(email)) {
    throw new HttpsError("permission-denied",
      "Your email is not in the admin whitelist.");
  }

  await db.collection("admins").doc(request.auth.uid).set({
    email,
    enabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection("auditLogs").add({
    action: "admin_bootstrap",
    actor: request.auth.uid,
    email,
    at: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true, email };
});

/* ─── 4. GET DOWNLOAD URL (callable, purchase-verified) ──── */
exports.getDownloadUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const productId = request.data?.productId;
  if (!productId) throw new HttpsError("invalid-argument", "productId required.");

  const uid = request.auth.uid;

  // Free product → always allow if it has downloadUrl
  const prodRef = db.collection("products").doc(productId);
  const prodSnap = await prodRef.get();
  if (!prodSnap.exists) throw new HttpsError("not-found", "Product not found.");
  const product = prodSnap.data();

  if (Number(product.price) === 0 && product.downloadUrl) {
    return { url: product.downloadUrl };
  }

  // Paid product → verify delivered/completed order contains it
  const ordersSnap = await db.collection("orders")
    .where("userId", "==", uid)
    .where("status", "in", ["delivered", "completed"])
    .get();

  const owns = ordersSnap.docs.some(d =>
    (d.data().items || []).some(i => i.productId === productId)
  );
  if (!owns) throw new HttpsError("permission-denied",
    "You do not own this product.");

  // Pull the private URL
  const priv = await prodRef.collection("private").doc("access").get();
  const url = priv.exists ? priv.data().downloadUrl : product.downloadUrl;
  if (!url) throw new HttpsError("not-found", "Download not configured.");
  return { url };
});

/* ─── 5. OPTIONAL: Daily summary at 9 AM Dhaka ──────────── */
exports.dailySummary = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Asia/Dhaka" },
  async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const snap = await db.collection("orders")
      .where("createdAt", ">=", yesterday).get();

    let revenue = 0, delivered = 0;
    snap.forEach(d => {
      const o = d.data();
      if (o.status === "delivered" || o.status === "completed") {
        revenue += o.total || 0;
        delivered++;
      }
    });

    await sendTelegram(
      `📊 <b>Daily Summary</b>\n\n` +
      `New orders: ${snap.size}\n` +
      `Delivered: ${delivered}\n` +
      `Revenue: ৳${revenue.toLocaleString()}`
    );
  }
);
