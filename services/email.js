// services/email.js — Resend email notifications
import dotenv from 'dotenv';
dotenv.config();

const RESEND_API = 'https://api.resend.com/emails';

async function send(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[Email] Resend error ${res.status}:`, JSON.stringify(data));
    } else {
      console.log(`[Email] Sent to ${Array.isArray(to) ? to.join(', ') : to} — id: ${data.id}`);
    }
  } catch (err) {
    console.error('[Email] Failed to send:', err.message);
  }
}

export async function sendWelcomeEmail(user) {
  const firstName = user.name?.split(' ')[0] || 'family';
  const shopUrl = `${process.env.SITE_URL || ''}/shop`;
  const html = `
  <div style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;">
    <div style="background:#c0392b;padding:3px 0;margin-bottom:32px;"></div>
    <div style="font-size:11px;letter-spacing:4px;color:#888;margin-bottom:10px;">WELCOME TO THE FAMILY</div>
    <h1 style="font-size:34px;font-weight:900;letter-spacing:-1px;line-height:1;margin:0 0 18px;">GRIT NEVER DIES,<br><span style="color:#c0392b;">${firstName.toUpperCase()}.</span></h1>
    <p style="color:#aaa;margin:0 0 24px;line-height:1.7;">
      You're in. Dead Concrete is more than a name — it's a mindset. Concrete is the hardest surface we know, and even when it looks dead or broken, it still stands. Streetwear born from resilience, hand-printed, built for those who refuse to quit.
    </p>
    <p style="color:#aaa;margin:0 0 32px;line-height:1.7;">
      The catalogue is now open to you. Pick your size, lock it in, and we'll handle the rest.
    </p>
    ${shopUrl ? `<p style="margin:0 0 36px;"><a href="${shopUrl}" style="display:inline-block;background:#c0392b;color:#fff;text-decoration:none;padding:16px 32px;font-weight:900;letter-spacing:2px;font-size:14px;">SHOP THE DROP</a></p>` : ''}
    <div style="border-left:3px solid #c0392b;padding:6px 0 6px 18px;margin:0 0 28px;">
      <div style="font-size:11px;letter-spacing:3px;color:#888;margin-bottom:4px;">FOUNDER'S NOTE</div>
      <div style="font-weight:800;color:#fff;line-height:1.5;">"Greatness rises from the hardest places."</div>
    </div>
    <p style="color:#666;font-size:13px;line-height:1.7;margin:0;">
      Questions? Reply to this email or DM us on WhatsApp at <strong style="color:#fff;">+233 25 744 0091</strong>. We ship from Accra.
    </p>
    <div style="margin-top:40px;border-top:1px solid #1a1a1a;padding-top:20px;color:#333;font-size:11px;letter-spacing:3px;">
      DEAD CONCRETE — RESURRECTION · TANK TOPS
    </div>
  </div>`;
  await send(user.email, `Welcome to Dead Concrete, ${firstName}.`, html);
}

export async function sendPasswordResetEmail(user, resetUrl) {
  const html = `
  <div style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;">
    <div style="background:#c0392b;padding:3px 0;margin-bottom:32px;"></div>
    <h1 style="font-size:30px;font-weight:900;letter-spacing:-1px;margin:0 0 12px;">RESET YOUR PASSWORD</h1>
    <p style="color:#aaa;margin:0 0 28px;line-height:1.6;">
      Hey ${user.name?.split(' ')[0] || 'there'} — someone (hopefully you) asked to reset the password for the Dead Concrete account tied to <strong style="color:#fff;">${user.email}</strong>.
    </p>
    <p style="margin:0 0 32px;">
      <a href="${resetUrl}" style="display:inline-block;background:#c0392b;color:#fff;text-decoration:none;padding:16px 32px;font-weight:900;letter-spacing:2px;font-size:14px;">RESET PASSWORD</a>
    </p>
    <p style="color:#666;font-size:13px;line-height:1.6;margin:0 0 8px;">
      This link expires in <strong style="color:#fff;">1 hour</strong>. If you didn't request a reset, you can safely ignore this email — your password stays unchanged.
    </p>
    <p style="color:#444;font-size:12px;word-break:break-all;margin:24px 0 0;">
      Trouble with the button? Paste this into your browser:<br>
      <span style="color:#c0392b;">${resetUrl}</span>
    </p>
    <div style="margin-top:40px;border-top:1px solid #1a1a1a;padding-top:20px;color:#333;font-size:11px;letter-spacing:3px;">
      DEAD CONCRETE — RESURRECTION · TANK TOPS
    </div>
  </div>`;
  await send(user.email, 'Reset your Dead Concrete password', html);
}

export async function sendNewOrderAlert(order, items, paymentMethod = 'unknown') {
  if (!process.env.ADMIN_EMAIL) return;
  const recipient = order.guest_email || order.customer_email || 'no-email';
  const rows = items.map(i =>
    `<tr>
      <td style="padding:10px;border-bottom:1px solid #222;">${i.product_name}${i.size ? ` <span style="color:#c0392b;font-weight:700;">· ${i.size}</span>` : ''}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:center;">×${i.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:right;">GHS ${i.total_price.toFixed(2)}</td>
    </tr>`
  ).join('');

  const methodLabel = paymentMethod === 'momo' ? '📱 Mobile Money' : paymentMethod === 'card' ? '💳 Card' : paymentMethod === 'bank' ? '🏦 Bank Transfer' : paymentMethod;
  const html = `
  <div style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;max-width:620px;margin:0 auto;">
    <div style="background:#c0392b;padding:3px 0;margin-bottom:32px;"></div>
    <h1 style="font-size:28px;font-weight:900;letter-spacing:-1px;margin:0 0 8px;">🧱 NEW ORDER — ${order.id}</h1>
    <p style="color:#888;margin:0 0 28px;">Customer placed via <strong style="color:#fff;">${methodLabel}</strong> · ${order.stripe_payment_status === 'succeeded' ? '<span style="color:#27ae60;font-weight:800;">PAID</span>' : '<span style="color:#f7941d;font-weight:800;">AWAITING PAYMENT</span>'}</p>

    <div style="background:#111;border-left:3px solid #c0392b;padding:18px 20px;margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:3px;color:#c0392b;margin-bottom:10px;font-weight:800;">CUSTOMER</div>
      <div style="color:#fff;font-size:17px;font-weight:700;margin-bottom:4px;">${order.shipping_name || '—'}</div>
      <div style="color:#bbb;font-size:14px;line-height:1.7;">
        📧 <a href="mailto:${recipient}" style="color:#bbb;">${recipient}</a><br>
        📱 ${order.shipping_phone || '—'}
      </div>
    </div>

    <div style="background:#111;border-left:3px solid #f7941d;padding:18px 20px;margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:3px;color:#f7941d;margin-bottom:10px;font-weight:800;">SHIPPING ADDRESS</div>
      <div style="color:#fff;font-size:15px;line-height:1.7;">
        ${order.shipping_address || '—'}<br>
        ${order.shipping_city || ''} ${order.shipping_zip || ''}
      </div>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#111;margin-bottom:8px;">
      <thead>
        <tr style="border-bottom:2px solid #c0392b;">
          <th style="padding:12px;text-align:left;font-size:11px;letter-spacing:2px;color:#555;">ITEM</th>
          <th style="padding:12px;text-align:center;font-size:11px;letter-spacing:2px;color:#555;">QTY</th>
          <th style="padding:12px;text-align:right;font-size:11px;letter-spacing:2px;color:#555;">SUBTOTAL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:14px 0;text-align:right;font-size:22px;font-weight:900;color:#c0392b;">
      TOTAL: GHS ${order.total.toFixed(2)}
    </div>

    ${order.notes ? `<div style="background:#1a1100;border:1px solid #f7941d;padding:14px 18px;margin-top:16px;"><div style="font-size:10px;letter-spacing:2px;color:#f7941d;margin-bottom:6px;font-weight:800;">MOMO / TXN REFERENCE</div><div style="color:#fff;font-family:monospace;word-break:break-all;">${order.notes}</div></div>` : ''}

    <p style="margin-top:28px;color:#555;font-size:13px;line-height:1.6;">
      Open the admin panel to verify, update status, or reply: <a href="${process.env.SITE_URL || 'http://localhost:3000'}/?p=admin" style="color:#c0392b;">${process.env.SITE_URL || 'localhost:3000'}/admin</a>
    </p>
    <div style="margin-top:36px;border-top:1px solid #1a1a1a;padding-top:18px;color:#333;font-size:11px;letter-spacing:3px;">
      DEAD CONCRETE — RESURRECTION · TANK TOPS
    </div>
  </div>`;
  await send(process.env.ADMIN_EMAIL, `🧱 New Order ${order.id} — GHS ${order.total.toFixed(2)} · ${order.shipping_name || 'customer'}`, html);
}

export async function sendOrderConfirmation(order, items) {
  const rows = items.map(i =>
    `<tr>
      <td style="padding:10px;border-bottom:1px solid #222;">${i.product_name}${i.size ? ` <span style="color:#c0392b;">· ${i.size}</span>` : ''}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:center;">×${i.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:right;">GHS ${i.total_price.toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = `
  <div style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;">
    <div style="background:#c0392b;padding:3px 0;margin-bottom:32px;"></div>
    <h1 style="font-size:32px;font-weight:900;letter-spacing:-1px;margin:0 0 8px;">ORDER CONFIRMED</h1>
    <p style="color:#888;margin:0 0 32px;">Order <strong style="color:#fff;">${order.id}</strong> — we start production within 48 hours.</p>
    <table style="width:100%;border-collapse:collapse;background:#111;">
      <thead>
        <tr style="border-bottom:2px solid #c0392b;">
          <th style="padding:12px;text-align:left;font-size:11px;letter-spacing:2px;color:#555;">PRODUCT</th>
          <th style="padding:12px;text-align:center;font-size:11px;letter-spacing:2px;color:#555;">QTY</th>
          <th style="padding:12px;text-align:right;font-size:11px;letter-spacing:2px;color:#555;">TOTAL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:16px 0;text-align:right;font-size:22px;font-weight:900;color:#c0392b;">
      TOTAL: GHS ${order.total.toFixed(2)}
    </div>
    <div style="background:#111;padding:20px;margin-top:16px;">
      <div style="font-size:10px;letter-spacing:3px;color:#555;margin-bottom:6px;">SHIPPING TO</div>
      <div style="color:#aaa;line-height:1.7;">${order.shipping_name}<br>${order.shipping_address}<br>${order.shipping_city} ${order.shipping_zip}${order.shipping_phone ? `<br>📱 ${order.shipping_phone}` : ''}</div>
    </div>
    <p style="margin-top:32px;color:#555;font-size:13px;">
      Track your order at <a href="${process.env.SITE_URL || 'http://localhost:3000'}" style="color:#c0392b;">deadconcrete.com</a> using order ID <strong>${order.id}</strong>
    </p>
    <div style="margin-top:40px;border-top:1px solid #1a1a1a;padding-top:20px;color:#333;font-size:11px;letter-spacing:3px;">
      DEAD CONCRETE — RESURRECTION · TANK TOPS
    </div>
  </div>`;

  const recipient = order.guest_email || order.customer_email;
  if (recipient) await send(recipient, `Order Confirmed — ${order.id}`, html);

  // Admin gets a payment-confirmed nudge (the detailed alert was already sent at order creation)
  if (process.env.ADMIN_EMAIL) {
    await send(
      process.env.ADMIN_EMAIL,
      `✅ Payment confirmed: ${order.id} — GHS ${order.total.toFixed(2)}`,
      `<div style="font-family:sans-serif;padding:24px;background:#0a0a0a;color:#fff;"><h2 style="color:#27ae60;">✅ PAID — ${order.id}</h2><p>Payment cleared for <strong>${order.shipping_name}</strong> (${recipient || 'guest'}).</p><p style="font-size:22px;font-weight:900;color:#c0392b;">GHS ${order.total.toFixed(2)}</p><p>Full order details were already sent in the original "New Order" email. Start production within 48 hours.</p></div>`
    );
  }
}

export async function sendQuoteAlert(quote) {
  if (!process.env.ADMIN_EMAIL) return;
  const html = `
  <div style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;max-width:600px;">
    <h2 style="color:#c0392b;">New Quote Request</h2>
    <p><strong>From:</strong> ${quote.name} (${quote.email})</p>
    ${quote.phone ? `<p><strong>Phone:</strong> ${quote.phone}</p>` : ''}
    ${quote.project_type ? `<p><strong>Project:</strong> ${quote.project_type}</p>` : ''}
    ${quote.dimensions ? `<p><strong>Dimensions:</strong> ${quote.dimensions}</p>` : ''}
    <p><strong>Message:</strong></p>
    <blockquote style="border-left:3px solid #c0392b;padding-left:16px;color:#aaa;">${quote.message}</blockquote>
    <p><a href="mailto:${quote.email}" style="color:#c0392b;">Reply to ${quote.name}</a></p>
  </div>`;
  await send(process.env.ADMIN_EMAIL, `📐 New Quote Request — ${quote.name}`, html);
}

export async function sendMomoAlert(order, items) {
  if (!process.env.ADMIN_EMAIL) return;
  const rows = items.map(i =>
    `<tr>
      <td style="padding:10px;border-bottom:1px solid #222;">${i.product_name}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:center;">×${i.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:right;">GHS ${i.total_price.toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = `
  <div style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:40px;max-width:600px;margin:0 auto;">
    <div style="background:#f7941d;padding:3px 0;margin-bottom:32px;"></div>
    <h1 style="font-size:28px;font-weight:900;letter-spacing:-1px;margin:0 0 8px;">📱 MOMO PAYMENT — ACTION REQUIRED</h1>
    <p style="color:#f7941d;font-weight:bold;margin:0 0 8px;">Verify this payment in your MTN wallet before confirming the order.</p>
    <p style="color:#888;margin:0 0 32px;">Order <strong style="color:#fff;">${order.id}</strong> — ${order.shipping_name}</p>

    <div style="background:#1a1100;border:2px solid #f7941d;padding:20px;margin-bottom:24px;border-radius:4px;">
      <div style="font-size:10px;letter-spacing:3px;color:#f7941d;margin-bottom:8px;">MOMO TRANSACTION REFERENCE</div>
      <div style="font-size:22px;font-weight:900;color:#fff;word-break:break-all;">${order.notes || 'N/A'}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#111;">
      <thead>
        <tr style="border-bottom:2px solid #f7941d;">
          <th style="padding:12px;text-align:left;font-size:11px;letter-spacing:2px;color:#555;">PRODUCT</th>
          <th style="padding:12px;text-align:center;font-size:11px;letter-spacing:2px;color:#555;">QTY</th>
          <th style="padding:12px;text-align:right;font-size:11px;letter-spacing:2px;color:#555;">TOTAL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="padding:16px 0;text-align:right;font-size:22px;font-weight:900;color:#f7941d;">
      TOTAL: GHS ${order.total.toFixed(2)}
    </div>

    <div style="background:#111;padding:20px;margin-top:16px;">
      <div style="font-size:10px;letter-spacing:3px;color:#555;margin-bottom:6px;">SHIPPING TO</div>
      <div style="color:#aaa;">${order.shipping_name}<br>${order.shipping_address}, ${order.shipping_city} ${order.shipping_zip}</div>
    </div>

    <div style="background:#111;padding:20px;margin-top:16px;">
      <div style="font-size:10px;letter-spacing:3px;color:#555;margin-bottom:6px;">CUSTOMER CONTACT</div>
      <div style="color:#aaa;">${order.guest_email || order.customer_email || 'Guest'}</div>
    </div>

    <p style="margin-top:24px;color:#f7941d;font-size:13px;">
      Once you verify the payment in your MTN wallet, go to the admin panel and click <strong>VERIFY MOMO</strong> on order <strong>${order.id}</strong> to confirm and notify the customer.
    </p>
    <div style="margin-top:40px;border-top:1px solid #1a1a1a;padding-top:20px;color:#333;font-size:11px;letter-spacing:3px;">
      DEAD CONCRETE — TOPS · CAPS · CUSTOM PIECES
    </div>
  </div>`;

  await send(process.env.ADMIN_EMAIL, `📱 MoMo Payment — ${order.id} — GHS ${order.total.toFixed(2)}`, html);
}
