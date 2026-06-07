const BASE = 'http://localhost:3001/api';
let pass = 0, fail = 0;

function ok(label, val) {
  if (val) { console.log('  \u2713 ' + label); pass++; }
  else      { console.log('  \u2717 ' + label); fail++; }
}

async function req(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

// 1. HEALTH
console.log('\n── HEALTH ──');
const health = await fetch('http://localhost:3001/healthz').then(r => r.json());
ok('GET /healthz returns ok', health.status === 'ok');

// 2. CONFIG
console.log('\n── CONFIG ──');
const config = await req('GET', '/config');
ok('GET /config returns publishableKey', config.data.publishableKey?.startsWith('pk_'));

// 3. PRODUCTS
console.log('\n── PRODUCTS ──');
const prods = await req('GET', '/products');
ok('GET /products returns array', Array.isArray(prods.data));
ok('All products in stock', prods.data.every(p => p.in_stock === 1));
ok('Products have id/name/price', prods.data.every(p => p.id && p.name && p.price));
const cats = await req('GET', '/products?category=tops');
ok('Category filter works', cats.data.every(p => p.category === 'tops'));
const firstProduct = prods.data[0];

// 4. AUTH REGISTER
console.log('\n── AUTH: REGISTER ──');
const email = 'test_' + Date.now() + '@example.com';
const reg = await req('POST', '/auth/register', { name: 'Test User', email, password: 'pass123', phone: '555-1234' });
ok('POST /auth/register -> 201', reg.status === 201);
ok('Returns token', typeof reg.data.token === 'string');
ok('Role is customer', reg.data.user?.role === 'customer');
ok('Password not leaked', !reg.data.user?.password_hash);
const customerToken = reg.data.token;

const dup = await req('POST', '/auth/register', { name: 'Test', email, password: 'pass123' });
ok('Duplicate email -> 409', dup.status === 409);

const weak = await req('POST', '/auth/register', { name: 'X', email: 'xx@xx.com', password: '12' });
ok('Short password -> 400', weak.status === 400);

// 5. AUTH LOGIN
console.log('\n── AUTH: LOGIN ──');
const login = await req('POST', '/auth/login', { email, password: 'pass123' });
ok('POST /auth/login -> 200', login.status === 200);
ok('Returns token on login', typeof login.data.token === 'string');

const badLogin = await req('POST', '/auth/login', { email, password: 'wrong' });
ok('Wrong password -> 401', badLogin.status === 401);

// 6. ME & PROFILE
console.log('\n── AUTH: ME & PROFILE ──');
const me = await req('GET', '/auth/me', null, customerToken);
ok('GET /auth/me -> 200', me.status === 200);
ok('Correct user returned', me.data.email === email);

const profile = await req('PUT', '/auth/profile', {
  name: 'Updated Name', phone: '555-9999', address: '123 Main St', city: 'Atlanta', zip: '30301'
}, customerToken);
ok('PUT /auth/profile -> 200', profile.status === 200);
ok('Name updated', profile.data.name === 'Updated Name');
ok('Address saved', profile.data.address === '123 Main St');

const noAuth = await req('GET', '/auth/me');
ok('No token -> 401', noAuth.status === 401);

// 7. PAYMENT INTENT
console.log('\n── PAYMENT INTENT ──');
const intent = await req('POST', '/payments/intent', {
  items: [{ productId: firstProduct.id, quantity: 2 }],
  shipping: { name: 'Test User', address: '123 Main St', city: 'Atlanta', zip: '30301', phone: '555-1234' },
  guestEmail: email,
}, customerToken);
ok('POST /payments/intent -> 200', intent.status === 200);
ok('Returns clientSecret', typeof intent.data.clientSecret === 'string');
ok('Returns orderId', typeof intent.data.orderId === 'string');
ok('Total = price x qty', intent.data.total === firstProduct.price * 2);
const orderId = intent.data.orderId;

const badIntent = await req('POST', '/payments/intent', {
  items: [],
  shipping: { name: 'X', address: 'X', city: 'X', zip: 'X' }
});
ok('Empty items -> 400', badIntent.status === 400);

const fakeIntent = await req('POST', '/payments/intent', {
  items: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
  shipping: { name: 'X', address: 'X', city: 'X', zip: 'X' }
});
ok('Fake product -> 400', fakeIntent.status === 400);

// 8. ORDER TRACKING
console.log('\n── ORDER TRACKING ──');
const track = await req('GET', '/orders/track/' + orderId);
ok('GET /orders/track/:id -> 200', track.status === 200);
ok('Order has items array', Array.isArray(track.data.items) && track.data.items.length > 0);
ok('stripe_payment_intent not exposed', !track.data.stripe_payment_intent);
ok('user_id not exposed', !track.data.user_id);

const noOrder = await req('GET', '/orders/track/ORD-FAKE999');
ok('Unknown order -> 404', noOrder.status === 404);

// 9. MY ORDERS
console.log('\n── MY ORDERS ──');
const myOrders = await req('GET', '/orders/my', null, customerToken);
ok('GET /orders/my -> 200', myOrders.status === 200);
ok('New order appears in list', myOrders.data.some(o => o.id === orderId));

const myNoAuth = await req('GET', '/orders/my');
ok('No token -> 401', myNoAuth.status === 401);

// 10. REVIEWS
console.log('\n── REVIEWS ──');
const reviews = await req('GET', '/reviews?productId=' + firstProduct.id);
ok('GET /reviews -> 200', reviews.status === 200);
ok('Returns avgRating number', typeof reviews.data.avgRating === 'number');

const submitReview = await req('POST', '/reviews', {
  productId: firstProduct.id, rating: 5, title: 'Solid', body: 'Love it.'
}, customerToken);
ok('POST /reviews -> 201', submitReview.status === 201);

const dupReview = await req('POST', '/reviews', { productId: firstProduct.id, rating: 4 }, customerToken);
ok('Duplicate review -> 409', dupReview.status === 409);

const reviewNoAuth = await req('POST', '/reviews', { productId: firstProduct.id, rating: 5 });
ok('Review without auth -> 401', reviewNoAuth.status === 401);

// 11. CONTACT / QUOTE
console.log('\n── CONTACT / QUOTE ──');
const quote = await req('POST', '/contact', {
  name: 'Test', email, phone: '555-0000', projectType: 'Kitchen Countertop', message: 'Need a slab.'
});
ok('POST /contact -> 201', quote.status === 201);
ok('Returns quote id', typeof quote.data.id === 'string');

const badQuote = await req('POST', '/contact', { name: 'X' });
ok('Missing fields -> 400', badQuote.status === 400);

// 12. ADMIN
console.log('\n── ADMIN ──');
const adminLogin = await req('POST', '/auth/login', { email: 'admin@deadconcrete.com', password: 'admin123' });
ok('Admin login -> 200', adminLogin.status === 200);
ok('Admin role confirmed', adminLogin.data.user?.role === 'admin');
const adminToken = adminLogin.data.token;

const stats = await req('GET', '/admin/stats', null, adminToken);
ok('GET /admin/stats -> 200', stats.status === 200);
ok('Has totalRevenue', typeof stats.data.totalRevenue === 'number');
ok('Has byStatus array', Array.isArray(stats.data.byStatus));

const allOrders = await req('GET', '/orders', null, adminToken);
ok('GET /orders (admin) -> 200', allOrders.status === 200);
ok('Returns orders array', Array.isArray(allOrders.data.orders));

const statusUp = await req('PATCH', '/orders/' + orderId + '/status', {
  status: 'In Production', note: 'Started casting'
}, adminToken);
ok('PATCH /orders/:id/status -> 200', statusUp.status === 200);
ok('Status updated to In Production', statusUp.data.status === 'In Production');
ok('History entry recorded', statusUp.data.history?.length > 0);

const badStatus = await req('PATCH', '/orders/' + orderId + '/status', { status: 'Flying' }, adminToken);
ok('Invalid status -> 400', badStatus.status === 400);

const pendingR = await req('GET', '/reviews/pending', null, adminToken);
ok('GET /reviews/pending (admin) -> 200', pendingR.status === 200);
ok('New review appears in pending', pendingR.data.some(r => r.reviewer_name === 'Test User'));

const contacts = await req('GET', '/contact', null, adminToken);
ok('GET /contact (admin) -> 200', contacts.status === 200);

const customerHitsAdmin = await req('GET', '/admin/stats', null, customerToken);
ok('Customer blocked from admin routes -> 403', customerHitsAdmin.status === 403);

const unauthAdmin = await req('GET', '/orders');
ok('Unauthed /orders -> 401', unauthAdmin.status === 401);

// SUMMARY
console.log('\n' + '='.repeat(46));
console.log('  PASSED: ' + pass + '   FAILED: ' + fail + '   TOTAL: ' + (pass + fail));
console.log('='.repeat(46) + '\n');
