/* AppVerse Cloud Functions — reads Telegram token from Firestore (settings/secrets) */
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/* ─── Read Telegram config from Firestore on every call ─── */
async function getTelegramConfig() {
  try {
    const snap = await db.doc("settings/secrets").get();
    if (!snap.exists) return { token: null, chat: null };
    const d = snap.data();
    return {
      token: (d.telegramToken || "").trim(),
      chat:  (d.telegramChatId || "").trim()
    };
  } catch (err) {
    console.error("Failed to read settings/secrets:", err);
    return { token: null, chat: null };
  }
}

/* ─── Send Telegram message ─── */
async function sendTelegram(text) {
  const { token, chat } = await getTelegramConfig();
  if (!token || !chat) {
    console.warn("Telegram not configured in admin panel — skipping notification");
    return { ok: false, reason: "not_configured" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      console.error("Telegram API error:", body);
      return { ok: false, reason: body.description || "api_error" };
    }
    return { ok: true };
  } catch (err) {
    console.error("Telegram fetch failed:", err);
    return { ok: false, reason: err.message };
  }
}

const escapeHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ─── Verify caller is admin ─── */
async function assertAdmin(uid) {
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists || snap.data().enabled !== true) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

/* ─── 1. NEW ORDER → Telegram ─── */
exports.onOrderCreated = onDocumentCreated("orders/{orderId}", async (event) => {
  const o = event.data.data();
  const items = (o.items || [])
    .map(i => `• ${escapeHtml(i.name)} × ${i.qty}`)
    .join("\n");
  const text =
    `🛒 <b>New Order Received</b>\n\n` +
    `<b>Order ID:</b> <code>${event.params.orderId}</code>\n` +
    `<b>Customer:</b> ${escapeHtml(o.customerName || "—")}\n` +
    `<b>Phone:</b> ${escapeHtml(o.contactNumber || "—")}\n` +
    `<b>Payment:</b> ${escapeHtml(o.paymentMethod || "—")} (${escapeHtml(o.transactionReference || "N/A")})\n` +
    `<b>Total:</b> ৳${Number(o.total || 0).toLocaleString("en-BD")}\n\n` +
    `<b>Items:</b>\n${items}`;
  await sendTelegram(text);
});

/* ─── 2. ORDER STATUS CHANGE → Telegram ─── */
exports.onOrderUpdated = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();
  if (before.status === after.status) return;

  const emojiMap = {
    confirmed: "✅",
    payment_submitted: "📤",
    under_review: "🔍",
    payment_verified: "💳",
    delivered: "📦",
    completed: "🎉",
    cancelled: "❌",
    refunded: "↩️",
    pending: "⏳"
  };
  const emoji = emojiMap[after.status] || "🔄";

  const text =
    `${emoji} <b>Order Status Updated</b>\n\n` +
    `<b>Order:</b> <code>${event.params.orderId}</code>\n` +
    `<b>Customer:</b> ${escapeHtml(after.customerName || "—")}\n` +
    `<b>New Status:</b> <b>${escapeHtml(after.status)}</b>\n` +
    `<b>Previous:</b> ${escapeHtml(before.status || "—")}`;
  await sendTelegram(text);
});

/* ─── 3. BOOTSTRAP FIRST ADMIN ─── */
/* If NO admins exist yet, allow first signed-in user to claim admin. */
/* Once one admin exists, this endpoint refuses — new admins must be added by existing admin. */
exports.bootstrapAdmin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");

  const adminsSnap = await db.collection("admins").limit(1).get();
  if (!adminsSnap.empty) {
    throw new HttpsError(
      "permission-denied",
      "Admins already exist. Ask an existing admin to grant you access from the Users panel."
    );
  }

  await db.doc(`admins/${request.auth.uid}`).set({
    email: request.auth.token.email || "",
    enabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection("auditLogs").add({
    action: "first_admin_bootstrap",
    uid: request.auth.uid,
    email: request.auth.token.email || "",
    at: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true, email: request.auth.token.email || "" };
});

/* ─── 4. GRANT / REVOKE ADMIN (existing admin only) ─── */
exports.grantAdmin = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertAdmin(request.auth.uid);

  const { targetUid, email, action } = request.data || {};
  if (!targetUid) throw new HttpsError("invalid-argument", "targetUid required");
  if (targetUid === request.auth.uid && action === "revoke") {
    throw new HttpsError("failed-precondition", "You cannot revoke your own admin access.");
  }

  if (action === "revoke") {
    await db.doc(`admins/${targetUid}`).delete();
    await db.collection("auditLogs").add({
      action: "admin_revoked",
      targetUid,
      actor: request.auth.uid,
      at: admin.firestore.FieldValue.serverTimestamp()
    });
    return { ok: true, action: "revoked" };
  }

  // grant
  await db.doc(`admins/${targetUid}`).set({
    email: email || "",
    enabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection("auditLogs").add({
    action: "admin_granted",
    targetUid,
    actor: request.auth.uid,
    at: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, action: "granted" };
});

/* ─── 5. TEST TELEGRAM (admin clicks button in panel) ─── */
exports.testTelegram = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  await assertAdmin(request.auth.uid);

  const cfg = await getTelegramConfig();
  if (!cfg.token || !cfg.chat) {
    throw new HttpsError(
      "failed-precondition",
      "Telegram token or chat ID not saved yet. Fill both fields and click Save first."
    );
  }

  const result = await sendTelegram(
    "✅ <b>AppVerse — Test Message</b>\n\n" +
    "Telegram integration is working. You will receive notifications here."
  );

  if (!result.ok) {
    throw new HttpsError("internal", `Telegram error: ${result.reason}`);
  }
  return { ok: true };
});

/* ─── 6. GET DOWNLOAD URL (purchase verified) ─── */
exports.getDownloadUrl = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const productId = request.data?.productId;
  if (!productId) throw new HttpsError("invalid-argument", "productId required.");

  const uid = request.auth.uid;
  const prodRef = db.doc(`products/${productId}`);
  const prodSnap = await prodRef.get();
  if (!prodSnap.exists) throw new HttpsError("not-found", "Product not found.");
  const product = prodSnap.data();

  // Free product → allow
  if (Number(product.price) === 0 && product.downloadUrl) {
    return { url: product.downloadUrl };
  }

  // Paid product → check owned order
  const ordersSnap = await db.collection("orders")
    .where("userId", "==", uid)
    .where("status", "in", ["delivered", "completed"])
    .get();

  const owns = ordersSnap.docs.some(d =>
    (d.data().items || []).some(i => i.productId === productId)
  );
  if (!owns) throw new HttpsError("permission-denied", "You do not own this product.");

  const priv = await prodRef.collection("private").doc("access").get();
  const url = priv.exists ? priv.data().downloadUrl : product.downloadUrl;
  if (!url) throw new HttpsError("not-found", "Download not configured.");
  return { url };
});

/* ─── 7. DAILY SUMMARY at 9 AM Dhaka ─── */
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
      `Revenue: ৳${revenue.toLocaleString("en-BD")}`
    );
  }
);
