// routes/api.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { sendQuoteAlert, sendMomoAlert, sendOrderConfirmation, sendPasswordResetEmail, sendNewOrderAlert } from '../services/email.js';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();

// ── CONFIG ────────────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  res.json({
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    momo: { number: process.env.MOMO_NUMBER, name: process.env.MOMO_NAME },
    bank: {
      name: process.env.BANK_NAME,
      accountName: process.env.BANK_ACCOUNT_NAME,
      accountNumber: process.env.BANK_ACCOUNT_NUMBER,
    },
  });
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

router.post('/auth/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  const db = getDb();
  try {
    const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const hash = bcrypt.hashSync(password, 10);
    const id = uuid();
    db.prepare('INSERT INTO users (id,name,email,password_hash,phone) VALUES (?,?,?,?,?)').run(id, name, email, hash, phone || null);
    const user = db.prepare('SELECT id,name,email,role,phone FROM users WHERE id=?').get(id);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } finally { db.close(); }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const db = getDb();
  try {
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google sign-in. Continue with Google instead.' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, reset_token, reset_token_expires_at, ...safe } = user;
    res.json({ token, user: safe });
  } finally { db.close(); }
});

router.get('/auth/me', requireAuth, (req, res) => {
  const db = getDb();
  try {
    const user = db.prepare('SELECT id,name,email,role,phone,address,city,zip FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } finally { db.close(); }
});

router.put('/auth/profile', requireAuth, (req, res) => {
  const { name, phone, address, city, zip } = req.body;
  const db = getDb();
  try {
    db.prepare("UPDATE users SET name=?,phone=?,address=?,city=?,zip=?,updated_at=datetime('now') WHERE id=?")
      .run(name, phone || null, address || null, city || null, zip || null, req.user.id);
    const user = db.prepare('SELECT id,name,email,role,phone,address,city,zip FROM users WHERE id=?').get(req.user.id);
    res.json(user);
  } finally { db.close(); }
});

// ── PASSWORD RESET ────────────────────────────────────────────────────────────

router.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const db = getDb();
  try {
    const user = db.prepare('SELECT id,name,email FROM users WHERE email=?').get(email);
    // Always respond OK to prevent email enumeration
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      db.prepare('UPDATE users SET reset_token=?, reset_token_expires_at=? WHERE id=?')
        .run(token, expiresAt, user.id);
      const base = process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const resetUrl = `${base}/?reset=${token}`;
      sendPasswordResetEmail(user, resetUrl).catch(console.error);
    }
    res.json({ ok: true });
  } finally { db.close(); }
});

router.post('/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const db = getDb();
  try {
    const user = db.prepare('SELECT id, reset_token_expires_at FROM users WHERE reset_token=?').get(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Reset link has expired — request a new one' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash=?, reset_token=NULL, reset_token_expires_at=NULL, updated_at=datetime('now') WHERE id=?")
      .run(hash, user.id);
    res.json({ ok: true });
  } finally { db.close(); }
});

// ── GOOGLE SIGN-IN ────────────────────────────────────────────────────────────

router.post('/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Google credential required' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not configured on this server' });

  // Verify Google ID token via tokeninfo endpoint (no extra deps needed)
  let payload;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    payload = await r.json();
    if (!r.ok || payload.error) throw new Error(payload.error_description || 'Invalid Google token');
  } catch (e) {
    return res.status(401).json({ error: 'Could not verify Google token' });
  }

  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
    return res.status(401).json({ error: 'Google token issued for a different app' });
  }
  if (!payload.email_verified || payload.email_verified === 'false') {
    return res.status(401).json({ error: 'Google account email not verified' });
  }

  const email = payload.email;
  const name = payload.name || email.split('@')[0];
  const googleId = payload.sub;

  const db = getDb();
  try {
    let user = db.prepare('SELECT * FROM users WHERE google_id=? OR email=?').get(googleId, email);
    if (user) {
      // Link google_id to an existing email/password account on first Google sign-in
      if (!user.google_id) {
        db.prepare('UPDATE users SET google_id=? WHERE id=?').run(googleId, user.id);
        user.google_id = googleId;
      }
    } else {
      const id = uuid();
      db.prepare('INSERT INTO users (id,name,email,google_id) VALUES (?,?,?,?)').run(id, name, email, googleId);
      user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const { password_hash, reset_token, reset_token_expires_at, ...safe } = user;
    res.json({ token, user: safe });
  } finally { db.close(); }
});

// ── PRODUCTS ──────────────────────────────────────────────────────────────────

router.get('/products', (req, res) => {
  const db = getDb();
  try {
    const { category } = req.query;
    let q = 'SELECT * FROM products WHERE in_stock=1';
    const p = [];
    if (category && category !== 'all') { q += ' AND category=?'; p.push(category); }
    res.json(db.prepare(q + ' ORDER BY created_at ASC').all(...p));
  } finally { db.close(); }
});

const cleanSizes = (raw) => {
  if (!raw) return 'S,M,L,XL,XXL';
  return String(raw).split(',').map(s => s.trim().toUpperCase()).filter(Boolean).join(',') || 'S,M,L,XL,XXL';
};

router.post('/products', requireAdmin, upload.single('image'), (req, res) => {
  const { name, category, price, description, badge, accent_color, sizes } = req.body;
  if (!name || !category || !price) return res.status(400).json({ error: 'Name, category and price required' });
  const db = getDb();
  try {
    const id = uuid();
    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : null;
    db.prepare('INSERT INTO products (id,name,category,price,description,badge,accent_color,image_url,sizes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, name, category, parseFloat(price), description || null, badge || null, accent_color || '#c0392b', imageUrl, cleanSizes(sizes));
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id=?').get(id));
  } finally { db.close(); }
});

router.put('/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  const { name, category, price, description, badge, accent_color, in_stock, sizes } = req.body;
  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });
    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : existing.image_url;
    const sz = sizes !== undefined ? cleanSizes(sizes) : (existing.sizes || 'S,M,L,XL,XXL');
    db.prepare("UPDATE products SET name=?,category=?,price=?,description=?,badge=?,accent_color=?,in_stock=?,image_url=?,sizes=?,updated_at=datetime('now') WHERE id=?")
      .run(name, category, parseFloat(price), description || null, badge || null, accent_color || '#c0392b', in_stock ?? 1, imageUrl, sz, req.params.id);
    res.json(db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id));
  } finally { db.close(); }
});

router.delete('/products/:id', requireAdmin, (req, res) => {
  const db = getDb();
  try { db.prepare('UPDATE products SET in_stock=0 WHERE id=?').run(req.params.id); res.json({ success: true }); }
  finally { db.close(); }
});

// ── PAYSTACK MOMO (automated — buyer approves in MoMo app) ───────────────────

router.post('/payments/momo', async (req, res) => {
  const { items, shipping, guestEmail, phone, provider } = req.body;
  if (!items?.length || !shipping) return res.status(400).json({ error: 'Items and shipping required' });
  if (!phone?.trim()) return res.status(400).json({ error: 'Phone number required' });
  if (!['mtn', 'vod', 'tgo'].includes(provider)) return res.status(400).json({ error: 'Select a valid network: mtn, vod, or tgo' });

  const db = getDb();
  try {
    let subtotal = 0;
    const validated = [];
    for (const item of items) {
      const p = db.prepare('SELECT * FROM products WHERE id=? AND in_stock=1').get(item.productId);
      if (!p) return res.status(400).json({ error: `Product not found: ${item.productId}` });
      const t = p.price * item.quantity;
      subtotal += t;
      validated.push({ p, quantity: item.quantity, t, size: item.size || null });
    }

    const orderId = `ORD-${Date.now().toString().slice(-6)}`;
    const userId = req.headers.authorization
      ? (() => { try { return jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET).id; } catch { return null; } })()
      : null;
    const email = guestEmail || (userId ? db.prepare('SELECT email FROM users WHERE id=?').get(userId)?.email : null) || 'guest@deadconcrete.com';

    db.prepare('INSERT INTO orders (id,user_id,guest_email,subtotal,total,shipping_name,shipping_address,shipping_city,shipping_zip,shipping_phone,stripe_payment_status,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(orderId, userId||null, guestEmail||null, subtotal, subtotal,
        shipping.name, shipping.address, shipping.city, shipping.zip, shipping.phone||null,
        'pending', 'Awaiting Payment');

    for (const { p, quantity, t, size } of validated) {
      db.prepare('INSERT INTO order_items (id,order_id,product_id,product_name,quantity,unit_price,total_price,size) VALUES (?,?,?,?,?,?,?,?)')
        .run(uuid(), orderId, p.id, p.name, quantity, p.price, t, size || null);
    }

    const chargeRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: Math.round(subtotal * 100),
        currency: 'GHS',
        mobile_money: { phone: phone.trim(), provider },
        metadata: { orderId },
      }),
    });

    const chargeData = await chargeRes.json();
    console.log('[Paystack /charge] HTTP', chargeRes.status, JSON.stringify(chargeData));

    // chargeData.status is the API-call success flag, not the payment status
    if (!chargeData.status) {
      return res.status(400).json({ error: chargeData.message || 'Payment initiation failed', paystack: chargeData });
    }

    const inner = chargeData.data || {};
    const innerStatus = inner.status; // 'pending' | 'send_otp' | 'pay_offline' | 'success' | 'failed'

    // Hard fails — no prompt will be sent
    if (innerStatus === 'failed') {
      return res.status(400).json({
        error: inner.message || inner.gateway_response || 'Mobile Money collection rejected by Paystack. Confirm MoMo is enabled on your live account.',
        paystackStatus: innerStatus,
        paystack: inner,
      });
    }

    const reference = inner.reference;
    db.prepare(`UPDATE orders SET stripe_payment_intent=? WHERE id=?`).run(reference, orderId);
    db.prepare('INSERT INTO order_status_history (id,order_id,status,note) VALUES (?,?,?,?)')
      .run(uuid(), orderId, 'Awaiting Payment', `Paystack MoMo (${innerStatus}) — ref: ${reference}`);

    // Notify admin immediately with full buyer details
    try {
      const fullOrder = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
      const fullItems = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
      sendNewOrderAlert(fullOrder, fullItems, 'momo').catch(console.error);
    } catch (e) { console.error('[admin alert] failed:', e); }

    res.status(201).json({
      orderId, reference, total: subtotal,
      paystackStatus: innerStatus,
      displayText: inner.display_text
        || (innerStatus === 'pay_offline'
            ? `Dial ${provider === 'mtn' ? '*170#' : provider === 'tgo' ? '*110#' : '*110#'} on your phone → My Wallet → Approvals to complete.`
            : innerStatus === 'send_otp'
            ? 'Paystack sent an OTP to your phone. Watch for the SMS.'
            : 'Approve the payment prompt on your phone.'),
    });
  } finally { db.close(); }
});

// ── PAYSTACK MOMO — Submit OTP (after send_otp) ──────────────────────────────
router.post('/payments/momo/otp', async (req, res) => {
  const { reference, otp } = req.body || {};
  if (!reference || !otp) return res.status(400).json({ error: 'Reference and OTP required' });

  const r = await fetch('https://api.paystack.co/charge/submit_otp', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference, otp: String(otp).trim() }),
  });
  const data = await r.json();
  console.log('[Paystack submit_otp] HTTP', r.status, JSON.stringify(data));

  if (!data.status) {
    return res.status(400).json({ error: data.message || 'OTP submission failed', paystack: data });
  }
  const inner = data.data || {};
  res.json({
    paystackStatus: inner.status,
    displayText: inner.display_text || (inner.status === 'pending' ? 'Approve the prompt on your phone now.' : inner.gateway_response || 'Submitted.'),
    paystack: inner,
  });
});

// ── PAYSTACK MOMO (automated — customer enters phone, gets USSD prompt) ──────

router.post('/payments/paystack', async (req, res) => {
  const { items, shipping, guestEmail, phone, provider } = req.body;
  if (!items?.length || !shipping) return res.status(400).json({ error: 'Items and shipping required' });
  if (!phone?.trim()) return res.status(400).json({ error: 'Phone number required' });
  if (!['mtn', 'vod', 'tgo'].includes(provider)) return res.status(400).json({ error: 'Select a valid network: mtn, vod, or tgo' });

  const db = getDb();
  try {
    let subtotal = 0;
    const validated = [];
    for (const item of items) {
      const p = db.prepare('SELECT * FROM products WHERE id=? AND in_stock=1').get(item.productId);
      if (!p) return res.status(400).json({ error: `Product not found: ${item.productId}` });
      const t = p.price * item.quantity;
      subtotal += t;
      validated.push({ p, quantity: item.quantity, t, size: item.size || null });
    }

    const orderId = `ORD-${Date.now().toString().slice(-6)}`;
    const userId = req.headers.authorization
      ? (() => { try { return jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET).id; } catch { return null; } })()
      : null;
    const email = guestEmail || (userId ? db.prepare('SELECT email FROM users WHERE id=?').get(userId)?.email : null) || 'guest@deadconcrete.com';

    db.prepare('INSERT INTO orders (id,user_id,guest_email,subtotal,total,shipping_name,shipping_address,shipping_city,shipping_zip,shipping_phone,stripe_payment_status,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(orderId, userId||null, guestEmail||null, subtotal, subtotal,
        shipping.name, shipping.address, shipping.city, shipping.zip, shipping.phone||null,
        'pending', 'Awaiting Payment');

    for (const { p, quantity, t, size } of validated) {
      db.prepare('INSERT INTO order_items (id,order_id,product_id,product_name,quantity,unit_price,total_price,size) VALUES (?,?,?,?,?,?,?,?)')
        .run(uuid(), orderId, p.id, p.name, quantity, p.price, t, size || null);
    }

    const chargeRes = await fetch('https://api.paystack.co/charge', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: Math.round(subtotal * 100),
        currency: 'GHS',
        mobile_money: { phone: phone.trim(), provider },
        metadata: { orderId },
      }),
    });

    const chargeData = await chargeRes.json();
    if (!chargeData.status) {
      return res.status(400).json({ error: chargeData.message || 'Payment initiation failed' });
    }

    const reference = chargeData.data.reference;
    db.prepare(`UPDATE orders SET stripe_payment_intent=? WHERE id=?`).run(reference, orderId);
    db.prepare('INSERT INTO order_status_history (id,order_id,status,note) VALUES (?,?,?,?)')
      .run(uuid(), orderId, 'Awaiting Payment', `Paystack MoMo initiated — ref: ${reference}`);

    try {
      const fullOrder = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
      const fullItems = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
      sendNewOrderAlert(fullOrder, fullItems, 'momo').catch(console.error);
    } catch (e) { console.error('[admin alert] failed:', e); }

    res.status(201).json({
      orderId,
      reference,
      total: subtotal,
      displayText: chargeData.data.display_text || 'Approve the prompt on your phone.',
    });
  } finally { db.close(); }
});

// ── BANK TRANSFER (manual) ────────────────────────────────────────────────────

router.post('/payments/bank', async (req, res) => {
  const { items, shipping, guestEmail } = req.body;
  if (!items?.length || !shipping) return res.status(400).json({ error: 'Items and shipping required' });

  const db = getDb();
  try {
    let subtotal = 0;
    const validated = [];
    for (const item of items) {
      const p = db.prepare('SELECT * FROM products WHERE id=? AND in_stock=1').get(item.productId);
      if (!p) return res.status(400).json({ error: `Product not found: ${item.productId}` });
      const t = p.price * item.quantity;
      subtotal += t;
      validated.push({ p, quantity: item.quantity, t, size: item.size || null });
    }

    const orderId = `ORD-${Date.now().toString().slice(-6)}`;
    const userId = req.headers.authorization
      ? (() => { try { return jwt.verify(req.headers.authorization.split(' ')[1], process.env.JWT_SECRET).id; } catch { return null; } })()
      : null;

    db.prepare('INSERT INTO orders (id,user_id,guest_email,subtotal,total,shipping_name,shipping_address,shipping_city,shipping_zip,shipping_phone,stripe_payment_status,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(orderId, userId||null, guestEmail||null, subtotal, subtotal,
        shipping.name, shipping.address, shipping.city, shipping.zip, shipping.phone||null,
        'momo_pending', 'Pending Payment');

    for (const { p, quantity, t, size } of validated) {
      db.prepare('INSERT INTO order_items (id,order_id,product_id,product_name,quantity,unit_price,total_price,size) VALUES (?,?,?,?,?,?,?,?)')
        .run(uuid(), orderId, p.id, p.name, quantity, p.price, t, size || null);
    }

    db.prepare('INSERT INTO order_status_history (id,order_id,status,note) VALUES (?,?,?,?)')
      .run(uuid(), orderId, 'Pending Payment', 'Bank transfer order placed');

    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    // /payments/bank is also called for card via Paystack popup; the popup flow detects channel separately
    const paymentMethod = req.body.paymentMethod || 'bank';
    sendNewOrderAlert(order, orderItems, paymentMethod).catch(console.error);

    res.status(201).json({ orderId, total: subtotal });
  } finally { db.close(); }
});

// ── PAYMENT VERIFY (poll for MoMo confirmation) ───────────────────────────────

router.get('/payments/verify/:reference', async (req, res) => {
  try {
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${req.params.reference}`, {
      headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const data = await verifyRes.json();
    if (data.status && data.data.status === 'success') {
      const orderId = data.data.metadata?.orderId;
      if (orderId) {
        const db = getDb();
        try {
          const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
          if (order && order.stripe_payment_status !== 'succeeded') {
            db.prepare(`UPDATE orders SET stripe_payment_status='succeeded', status='Order Received', updated_at=datetime('now') WHERE id=?`).run(orderId);
            db.prepare(`INSERT INTO order_status_history (id,order_id,status,note) VALUES (?,?,?,?)`).run(uuid(), orderId, 'Order Received', 'Payment confirmed via Paystack');
            const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
            const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
            sendOrderConfirmation(updated, items).catch(console.error);
          }
        } finally { db.close(); }
      }
      return res.json({ status: 'success' });
    }
    res.json({ status: data.data?.status || 'pending' });
  } catch {
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── ORDERS ────────────────────────────────────────────────────────────────────

function fullOrder(db, id) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) return null;
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id);
  o.history = db.prepare('SELECT * FROM order_status_history WHERE order_id=? ORDER BY created_at ASC').all(id);
  return o;
}

router.get('/orders/track/:id', (req, res) => {
  const db = getDb();
  try {
    const o = fullOrder(db, req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    const { stripe_payment_intent, user_id, ...safe } = o;
    res.json(safe);
  } finally { db.close(); }
});

router.get('/orders/my', requireAuth, (req, res) => {
  const db = getDb();
  try {
    const orders = db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
    res.json(orders.map(o => { o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id); return o; }));
  } finally { db.close(); }
});

router.get('/orders', requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const orders = db.prepare('SELECT o.*,u.name as customer_name,u.email as customer_email FROM orders o LEFT JOIN users u ON o.user_id=u.id ORDER BY o.created_at DESC LIMIT 100').all();
    res.json({ orders, total: orders.length });
  } finally { db.close(); }
});

router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
  const { status, note, trackingNumber, verifyMomo } = req.body;
  const VALID = ['Order Received', 'In Production', 'Quality Check', 'Shipped', 'Delivered', 'Cancelled', 'Pending Payment'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const db = getDb();
  try {
    const p = [status];
    let q = "UPDATE orders SET status=?,updated_at=datetime('now')";
    if (trackingNumber) { q += ',tracking_number=?'; p.push(trackingNumber); }
    if (verifyMomo)     { q += ",stripe_payment_status='momo_verified'"; }
    q += ' WHERE id=?'; p.push(req.params.id);
    db.prepare(q).run(...p);
    db.prepare('INSERT INTO order_status_history (id,order_id,status,note,changed_by) VALUES (?,?,?,?,?)')
      .run(uuid(), req.params.id, status, note || null, req.user.email);

    if (verifyMomo) {
      const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
      const items  = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id);
      sendOrderConfirmation(order, items).catch(console.error);
    }

    res.json(fullOrder(db, req.params.id));
  } finally { db.close(); }
});

// ── ADMIN STATS ───────────────────────────────────────────────────────────────

router.get('/admin/stats', requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const PAID = "stripe_payment_status IN ('succeeded','momo_verified')";
    const totalRevenue = db.prepare(`SELECT COALESCE(SUM(total),0) as r FROM orders WHERE ${PAID}`).get().r;
    const totalOrders = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE ${PAID}`).get().c;
    const pendingOrders = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('Delivered','Cancelled') AND ${PAID}`).get().c;
    const momoAwating = db.prepare("SELECT COUNT(*) as c FROM orders WHERE stripe_payment_status='momo_pending'").get().c;
    const totalCustomers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='customer'").get().c;
    const recentOrders = db.prepare(`SELECT o.*,u.name as customer_name FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.${PAID} ORDER BY o.created_at DESC LIMIT 5`).all();
    const byStatus = db.prepare(`SELECT status,COUNT(*) as count FROM orders WHERE ${PAID} GROUP BY status`).all();
    const momoOrders = db.prepare("SELECT o.*,u.name as customer_name FROM orders o LEFT JOIN users u ON o.user_id=u.id WHERE o.stripe_payment_status='momo_pending' ORDER BY o.created_at DESC").all();
    res.json({ totalRevenue, totalOrders, pendingOrders, momoAwating, totalCustomers, recentOrders, byStatus, momoOrders });
  } finally { db.close(); }
});

router.delete('/admin/demo-cleanup', requireAdmin, (req, res) => {
  const db = getDb();
  try {
    const demoUsers = db.prepare("SELECT id FROM users WHERE (email LIKE '%@example.com' OR email LIKE '%@deadconcrete.com') AND role!='admin'").all().map(u=>u.id);
    if (demoUsers.length) {
      const placeholders = demoUsers.map(()=>'?').join(',');
      db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${placeholders}))`).run(...demoUsers);
      db.prepare(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (${placeholders}))`).run(...demoUsers);
      db.prepare(`DELETE FROM orders WHERE user_id IN (${placeholders})`).run(...demoUsers);
      db.prepare(`DELETE FROM reviews WHERE user_id IN (${placeholders})`).run(...demoUsers);
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...demoUsers);
    }
    db.prepare("DELETE FROM quote_requests WHERE email LIKE '%@example.com'").run();
    res.json({ success: true, deletedUsers: demoUsers.length });
  } finally { db.close(); }
});

// ── CONTACT / QUOTES ──────────────────────────────────────────────────────────

router.post('/contact', async (req, res) => {
  const { name, email, phone, projectType, dimensions, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  const db = getDb();
  try {
    const id = uuid();
    db.prepare('INSERT INTO quote_requests (id,name,email,phone,project_type,dimensions,message) VALUES (?,?,?,?,?,?,?)')
      .run(id, name, email, phone || null, projectType || null, dimensions || null, message);
    const quote = db.prepare('SELECT * FROM quote_requests WHERE id=?').get(id);
    sendQuoteAlert(quote).catch(console.error);
    res.status(201).json({ success: true, id });
  } finally { db.close(); }
});

router.get('/contact', requireAdmin, (req, res) => {
  const db = getDb();
  try { res.json(db.prepare('SELECT * FROM quote_requests ORDER BY created_at DESC').all()); }
  finally { db.close(); }
});

router.patch('/contact/:id', requireAdmin, (req, res) => {
  const { status, adminNote } = req.body;
  const db = getDb();
  try {
    db.prepare("UPDATE quote_requests SET status=?,admin_note=?,updated_at=datetime('now') WHERE id=?").run(status, adminNote || null, req.params.id);
    res.json(db.prepare('SELECT * FROM quote_requests WHERE id=?').get(req.params.id));
  } finally { db.close(); }
});

// ── REVIEWS ───────────────────────────────────────────────────────────────────

router.get('/reviews', (req, res) => {
  const { productId } = req.query;
  const db = getDb();
  try {
    let q = 'SELECT r.*,u.name as reviewer_name FROM reviews r LEFT JOIN users u ON r.user_id=u.id WHERE r.approved=1';
    const p = [];
    if (productId) { q += ' AND r.product_id=?'; p.push(productId); }
    const reviews = db.prepare(q + ' ORDER BY r.created_at DESC').all(...p);
    if (productId) {
      const agg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE product_id=? AND approved=1').get(productId);
      return res.json({ reviews, avgRating: Math.round((agg?.avg || 0) * 10) / 10, totalReviews: agg?.count || 0 });
    }
    res.json(reviews);
  } finally { db.close(); }
});

router.post('/reviews', requireAuth, (req, res) => {
  const { productId, rating, title, body } = req.body;
  if (!productId || !rating) return res.status(400).json({ error: 'Product and rating required' });
  const db = getDb();
  try {
    const existing = db.prepare('SELECT id FROM reviews WHERE user_id=? AND product_id=?').get(req.user.id, productId);
    if (existing) return res.status(409).json({ error: 'You already reviewed this product' });
    const id = uuid();
    db.prepare('INSERT INTO reviews (id,product_id,user_id,rating,title,body) VALUES (?,?,?,?,?,?)').run(id, productId, req.user.id, rating, title || null, body || null);
    res.status(201).json({ success: true, message: 'Review submitted — pending approval' });
  } finally { db.close(); }
});

router.get('/reviews/pending', requireAdmin, (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare('SELECT r.*,u.name as reviewer_name,p.name as product_name FROM reviews r LEFT JOIN users u ON r.user_id=u.id LEFT JOIN products p ON r.product_id=p.id WHERE r.approved=0 ORDER BY r.created_at DESC').all());
  } finally { db.close(); }
});

router.patch('/reviews/:id', requireAdmin, (req, res) => {
  const { approved } = req.body;
  const db = getDb();
  try {
    if (!approved) db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);
    else db.prepare('UPDATE reviews SET approved=1 WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } finally { db.close(); }
});

export default router;
