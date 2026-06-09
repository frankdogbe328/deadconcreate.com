// db/setup.js — run once: npm run setup
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'deadconcrete.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL, password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    phone TEXT, address TEXT, city TEXT, zip TEXT,
    google_id TEXT UNIQUE,
    reset_token TEXT,
    reset_token_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    category TEXT NOT NULL, price REAL NOT NULL,
    description TEXT, badge TEXT,
    accent_color TEXT DEFAULT '#c0392b',
    image_url TEXT, back_image_url TEXT,
    in_stock INTEGER DEFAULT 1,
    sizes TEXT DEFAULT 'S,M,L,XL,XXL',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, user_id TEXT, guest_email TEXT,
    status TEXT NOT NULL DEFAULT 'Order Received',
    subtotal REAL NOT NULL, total REAL NOT NULL,
    shipping_name TEXT, shipping_address TEXT,
    shipping_city TEXT, shipping_zip TEXT, shipping_phone TEXT,
    stripe_payment_intent TEXT,
    stripe_payment_status TEXT DEFAULT 'pending',
    tracking_number TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
    product_id TEXT NOT NULL, product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL, unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    size TEXT
  );
  CREATE TABLE IF NOT EXISTS order_status_history (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL,
    status TEXT NOT NULL, note TEXT, changed_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS quote_requests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    email TEXT NOT NULL, phone TEXT,
    project_type TEXT, dimensions TEXT,
    message TEXT NOT NULL, status TEXT DEFAULT 'new',
    admin_note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
    user_id TEXT NOT NULL, rating INTEGER NOT NULL,
    title TEXT, body TEXT, approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Idempotent migrations for existing DBs (CREATE TABLE IF NOT EXISTS skips ALTER)
const migrate = (sql) => { try { db.exec(sql); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } };
migrate(`ALTER TABLE users ADD COLUMN google_id TEXT`);
migrate(`ALTER TABLE users ADD COLUMN reset_token TEXT`);
migrate(`ALTER TABLE users ADD COLUMN reset_token_expires_at TEXT`);
migrate(`ALTER TABLE products ADD COLUMN sizes TEXT DEFAULT 'S,M,L,XL,XXL'`);
migrate(`ALTER TABLE products ADD COLUMN back_image_url TEXT`);
migrate(`ALTER TABLE order_items ADD COLUMN size TEXT`);

// Wipe and reseed
db.exec(`
  DELETE FROM order_items;
  DELETE FROM order_status_history;
  DELETE FROM orders;
  DELETE FROM reviews;
  DELETE FROM quote_requests;
  DELETE FROM products;
  DELETE FROM users;
`);

// Admin user — password from env, with a loud warning if the default is still in use
const adminEmail = process.env.ADMIN_LOGIN_EMAIL || 'admin@deadconcrete.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
if (adminPassword === 'admin123') {
  console.warn('⚠️  ADMIN_PASSWORD env var not set — using the public default "admin123". Rotate this on Render before going live.');
}
const adminHash = bcrypt.hashSync(adminPassword, 10);
db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)`)
  .run(uuid(), 'Admin', adminEmail, adminHash, 'admin');

// Optional demo customer/account data (set SEED_DEMO=false to skip in production)
const seedDemo = process.env.SEED_DEMO !== 'false';
let custId = null;
if (seedDemo) {
  const custHash = bcrypt.hashSync('demo123', 10);
  custId = uuid();
  db.prepare(`INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)`)
    .run(custId, 'John Builder', 'john@example.com', custHash, 'customer');
}

// Products — images live in /uploads/products/
// Each Resurrection tee has a FRONT (script logo) and BACK (rose graphic) view.
const products = [
  // ── RESURRECTION COLLECTION (oversized heavyweight tees) ──
  { name:'Resurrection Tee — Tan',   cat:'resurrection', price:230, desc:'Oversized heavyweight tee in sand tan. Chrome-gold "Dead Concrete" script logo on the front, skeleton-hand and rose graphic on the back.',  badge:'BESTSELLER', color:'#c19a6b', img:'/uploads/products/resurrection1.jpeg', back:'/uploads/products/resurrection4.jpeg' },
  { name:'Resurrection Tee — White', cat:'resurrection', price:230, desc:'Oversized white heavyweight tee. Chrome-gold "Dead Concrete" script on the front, skeleton-hand and rose graphic across the back.',         badge:'NEW',        color:'#c0392b', img:'/uploads/products/resurrection3.jpeg', back:'/uploads/products/resurrection2.jpeg' },
  { name:'Resurrection Tee — Black', cat:'resurrection', price:230, desc:'Oversized black heavyweight tee. Chrome-gold "Dead Concrete" script on the front, skeleton-hand and rose graphic on the back in blood red.', badge:'BESTSELLER', color:'#c0392b', img:'/uploads/products/resurrection6.jpeg', back:'/uploads/products/resurrection5.jpeg' },

  // ── GIRLS' TANK TOPS COLLECTION (fitted raglan crop tees) ──
  { name:'Girls Tank Top — Yellow Body', cat:'tops', price:150, desc:'Fitted raglan crop tee. Pastel yellow body with black sleeves and "Dead Concrete" varsity script.',                              badge:'NEW', color:'#f1c40f', img:'/uploads/products/standtops.jpeg',  back:null },
  { name:'Girls Tank Top — Black Body',  cat:'tops', price:150, desc:'Fitted raglan crop tee. Black body with pastel yellow sleeves and chain-stitched "Dead Concrete" varsity script.',                badge:null,  color:'#111111', img:'/uploads/products/standtops1.jpeg', back:null },
];

const ins = db.prepare(`INSERT INTO products (id,name,category,price,description,badge,accent_color,image_url,back_image_url,sizes) VALUES (?,?,?,?,?,?,?,?,?,?)`);
const productIds = [];
for (const p of products) {
  const id = uuid();
  const sizes = p.cat === 'tops' ? 'XS,S,M,L' : 'S,M,L,XL,XXL';
  ins.run(id, p.name, p.cat, p.price, p.desc, p.badge || null, p.color, p.img || null, p.back || null, sizes);
  productIds.push({ id, ...p });
}

if (seedDemo && custId) {
  // Demo orders
  const statuses = ['Delivered', 'In Production', 'Quality Check'];
  for (let i = 0; i < 3; i++) {
    const oid = `ORD-${2800 + i * 107}`;
    const prod = productIds[i];
    const qty = i === 0 ? 4 : 1;
    const total = prod.price * qty;
    db.prepare(`INSERT INTO orders (id,user_id,status,subtotal,total,shipping_name,shipping_address,shipping_city,shipping_zip,stripe_payment_status) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(oid, custId, statuses[i], total, total, 'John Builder', '123 Main St', 'Atlanta', '30301', 'succeeded');
    db.prepare(`INSERT INTO order_items (id,order_id,product_id,product_name,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?,?)`)
      .run(uuid(), oid, prod.id, prod.name, qty, prod.price, total);
    db.prepare(`INSERT INTO order_status_history (id,order_id,status,note) VALUES (?,?,?,?)`)
      .run(uuid(), oid, statuses[i], 'Status updated');
  }
}

db.close();
console.log('✅ Database ready!');
console.log(`👤 Admin:    ${adminEmail} / ${adminPassword === 'admin123' ? 'admin123 (DEFAULT — ROTATE!)' : '••••••• (from ADMIN_PASSWORD)'}`);
if (seedDemo) {
  console.log('👤 Customer: john@example.com / demo123');
} else {
  console.log('⚠️  Demo customer not seeded (SEED_DEMO=false)');
}
