/* functions/index.js — authoritative order creation, admin provisioning,
   order status updates, Telegram notifications. */

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/* ---------------- Telegram helper ----------------
   Configure with:
     firebase functions:secrets:set TELEGRAM_BOT_TOKEN
     firebase functions:secrets:set TELEGRAM_CHAT_ID
   Fallback to settings/public.telegramChatId if secret not set.
-------------------------------------------------- */
const { defineSecret } = require("firebase-functions/params");
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID   = defineSecret("TELEGRAM_CHAT_ID");

async function resolveChatId() {
  try {
    const chat = TELEGRAM_CHAT_ID.value();
    if (chat) return chat;
  } catch (_) {}
  try {
    const s = await db.doc("settings/public").get();
    if (s.exists && s.data().telegramChatId) return s.data().telegramChatId;
  } catch (_) {}
  return null;
}

async function sendTelegram(text) {
  let token;
  try { token = TELEGRAM_BOT_TOKEN.value(); } catch (_) { token = null; }
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN is not set — skipping notification.");
    return;
  }
  const chatId = await resolveChatId();
  if (!chatId) {
    logger.warn("Telegram chat ID missing — skipping notification.");
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    text,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      logger.error("Telegram send failed", res.status, t);
    }
  } catch (err) {
    logger.error("Telegram error", err);
  }
}

/* ---------------- isAdmin helper ---------------- */
async function assertAdmin(uid) {
  const snap = await db.doc(`admins/${uid}`).get();
  if (!snap.exists || snap.data().enabled !== true) {
    throw new HttpsError("permission-denied", "Administrator access required.");
  }
}

/* ---------------- createOrder (authoritative pricing) ---------------- */
exports.createOrder = onCall(
  { secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID], region: "us-central1" },
  async (req) => {
    const auth = req.auth;
    if (!auth) throw new HttpsError("unauthenticated", "Please sign in to place an order.");

    const data = req.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) throw new HttpsError("invalid-argument", "Cart is empty.");
    if (items.length > 30) throw new HttpsError("invalid-argument", "Too many items.");

    const customerName = String(data.customerName || "").trim().slice(0, 120);
    const contactNumber = String(data.contactNumber || "").trim().slice(0, 30);
    const paymentMethod = String(data.paymentMethod || "").trim();
    const txn = data.transactionReference ? String(data.transactionReference).trim().slice(0, 60) : null;
    const note = data.note ? String(data.note).trim().slice(0, 500) : null;

    if (customerName.length < 2) throw new HttpsError("invalid-argument", "Invalid name.");
    if (contactNumber.length < 6) throw new HttpsError("invalid-argument", "Invalid contact.");
    if (!["bkash", "nagad", "rocket", "cash"].includes(paymentMethod)) {
      throw new HttpsError("invalid-argument", "Unsupported payment method.");
    }

    // Load each product authoritatively from Firestore
    const enriched = [];
    let total = 0;
    for (const line of items) {
      const pid = String(line.productId || "");
      const qty = Math.max(1, Math.min(20, parseInt(line.qty, 10) || 1));
      if (!pid) throw new HttpsError("invalid-argument", "Bad productId.");
      const snap = await db.doc(`products/${pid}`).get();
      if (!snap.exists) throw new HttpsError("not-found", "A product no longer exists.");
      const p = snap.data();
      if (p.available === false) throw new HttpsError("failed-precondition", "A product became unavailable.");
      const price = Number(p.price) || 0;
      enriched.push({
        productId: pid,
        name: String(p.name || "").slice(0, 200),
        price,
        qty,
        imageUrl: String(p.imageUrl || "").slice(0, 2048),
      });
      total += price * qty;
    }

    const orderRef = db.collection("orders").doc();
    const order = {
      userId: auth.uid,
      customerName,
      contactNumber,
      items: enriched,
      total,
      paymentMethod,
      transactionReference: txn,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      note: note || null,
    };
    await orderRef.set(order);

    // Telegram notification
    const itemsText = enriched.map(i => `• ${i.name} × ${i.qty} — ৳${(i.price * i.qty).toLocaleString()}`).join("\n");
    await sendTelegram(
      `🛒 <b>New Order</b>\n` +
      `<b>ID:</b> <code>${orderRef.id}</code>\n` +
      `<b>Customer:</b> ${customerName}\n` +
      `<b>Phone:</b> ${contactNumber}\n` +
      `<b>Payment:</b> ${paymentMethod}${txn ? ` (ref ${txn})` : ""}\n` +
      `<b>Total:</b> ৳${total.toLocaleString()}\n\n${itemsText}`
    );

    return { ok: true, orderId: orderRef.id, total };
  }
);

/* ---------------- updateOrderStatus ---------------- */
exports.updateOrderStatus = onCall(
  { secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID], region: "us-central1" },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    await assertAdmin(req.auth.uid);
    const { orderId, status } = req.data || {};
    if (!orderId || !["pending", "confirmed", "completed", "cancelled"].includes(status)) {
      throw new HttpsError("invalid-argument", "Invalid status.");
    }
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
    await ref.update({ status, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    const o = snap.data();
    await sendTelegram(
      `📦 <b>Order status updated</b>\n` +
      `<b>ID:</b> <code>${orderId}</code>\n` +
      `<b>Customer:</b> ${o.customerName || "—"}\n` +
      `<b>New status:</b> ${status}`
    );
    return { ok: true };
  }
);

/* ---------------- grantAdmin (owner-only, protected by env whitelist UID) ----------------
   Set the OWNER_UID secret to your own Firebase Auth UID:
     firebase functions:secrets:set OWNER_UID
   Then call grantAdmin with { uid, email } and this function will only allow it
   if the caller is the owner.
   OR simply create admins/{uid} = { enabled: true } from the Firebase Console.
---------------------------------------------------------------------------------------- */
exports.grantAdmin = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const { uid } = req.data || {};
  if (!uid || typeof uid !== "string") throw new HttpsError("invalid-argument", "uid required.");

  // Allow if caller is already an admin
  const callerSnap = await db.doc(`admins/${req.auth.uid}`).get();
  const callerIsAdmin = callerSnap.exists && callerSnap.data().enabled === true;

  // OR if the caller is a bootstrap owner defined by an env var
  const ownerUid = process.env.OWNER_UID || "";
  const isOwner = ownerUid && ownerUid === req.auth.uid;

  if (!callerIsAdmin && !isOwner) {
    throw new HttpsError("permission-denied", "Not authorized.");
  }

  await db.doc(`admins/${uid}`).set({
    enabled: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    grantedBy: req.auth.uid,
  }, { merge: true });

  return { ok: true, uid };
});

/* ---------------- Firestore triggers for Telegram ---------------- */
exports.onNewUser = onDocumentCreated(
  { document: "users/{uid}", secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID], region: "us-central1" },
  async (event) => {
    const u = event.data?.data() || {};
    await sendTelegram(
      `👤 <b>New user registered</b>\n` +
      `<b>Name:</b> ${u.displayName || "—"}\n` +
      `<b>Email:</b> ${u.email || "—"}`
    );
  }
);