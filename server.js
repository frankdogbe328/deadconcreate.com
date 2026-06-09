// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { getDb } from './db/db.js';
import { v4 as uuid } from 'uuid';
import { sendOrderConfirmation } from './services/email.js';
import apiRouter from './routes/api.js';

dotenv.config();

// Environment validation for production safety
const requiredEnv = [
  'JWT_SECRET',
  'PAYSTACK_SECRET_KEY',
  'RESEND_API_KEY',
  'FROM_EMAIL',
  'ADMIN_EMAIL',
  'SITE_URL'
];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing required env vars:', missing.join(', '));
  process.exit(1);
}
if (!process.env.NODE_ENV) {
  console.warn('⚠️ NODE_ENV not set; defaulting to development');
  process.env.NODE_ENV = 'development';
}
if (process.env.NODE_ENV === 'production' && process.env.SECURE !== 'true') {
  console.warn('⚠️ Production running without SECURE=true. This is not recommended.');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── PAYSTACK WEBHOOK (must be before express.json()) ──────────────────────────
app.post('/webhooks/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    console.error('Paystack webhook signature mismatch');
    return res.status(400).send('Invalid signature');
  }

  const event = JSON.parse(req.body);

  if (event.event === 'charge.success') {
    const orderId = event.data.metadata?.orderId;
    if (orderId) {
      const db = getDb();
      try {
        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
        if (order && order.stripe_payment_status !== 'succeeded') {
          db.prepare(`UPDATE orders SET stripe_payment_status='succeeded', status='Order Received', updated_at=datetime('now') WHERE id=?`).run(orderId);
          db.prepare(`INSERT INTO order_status_history (id,order_id,status,note) VALUES (?,?,?,?)`).run(uuid(), orderId, 'Order Received', 'Payment confirmed via Paystack');
          const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
          const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
          if (updated) sendOrderConfirmation(updated, items).catch(console.error);
        }
      } finally { db.close(); }
    }
  }

  res.json({ received: true });
});

// ── GLOBAL MIDDLEWARE ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  // Allow Google Sign-In popup to communicate back to the parent window
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.SITE_URL : '*',
  credentials: true,
}));
app.use(express.json());

// Rate limiting — global
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Stricter limit on auth routes
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please wait 15 minutes.' },
}));

// Strict limit on payment routes — prevents brute-forcing of references
app.use('/api/payments', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts, please wait a moment.' },
}));

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', env: process.env.NODE_ENV });
});

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Dead Concrete running at http://localhost:${PORT}`);
  console.log(`   Open that URL in your browser\n`);
});
