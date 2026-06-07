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
      DEAD CONCRETE — RESURRECTION · STAND TOPS
    </div>
  </div>`;
  await send(user.email, 'Reset your Dead Concrete password', html);
}

export async function sendOrderConfirmation(order, items) {
  const rows = items.map(i =>
    `<tr>
      <td style="padding:10px;border-bottom:1px solid #222;">${i.product_name}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:center;">×${i.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #222;text-align:right;">$${i.total_price.toFixed(2)}</td>
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
      TOTAL: $${order.total.toFixed(2)}
    </div>
    <div style="background:#111;padding:20px;margin-top:16px;">
      <div style="font-size:10px;letter-spacing:3px;color:#555;margin-bottom:6px;">SHIPPING TO</div>
      <div style="color:#aaa;">${order.shipping_name}<br>${order.shipping_address}, ${order.shipping_city} ${order.shipping_zip}</div>
    </div>
    <p style="margin-top:32px;color:#555;font-size:13px;">
      Track your order at <a href="${process.env.SITE_URL || 'http://localhost:3000'}" style="color:#c0392b;">deadconcrete.com</a> using order ID <strong>${order.id}</strong>
    </p>
    <div style="margin-top:40px;border-top:1px solid #1a1a1a;padding-top:20px;color:#333;font-size:11px;letter-spacing:3px;">
      DEAD CONCRETE — TOPS · CAPS · CUSTOM PIECES
    </div>
  </div>`;

  const recipient = order.guest_email || order.customer_email;
  if (recipient) await send(recipient, `Order Confirmed — ${order.id}`, html);

  // Notify admin too
  if (process.env.ADMIN_EMAIL) {
    await send(
      process.env.ADMIN_EMAIL,
      `🧱 New Order: ${order.id} — $${order.total.toFixed(2)}`,
      `<p>New order <strong>${order.id}</strong> placed by ${order.shipping_name} (${recipient || 'guest'}).</p><p>Total: <strong>$${order.total.toFixed(2)}</strong></p>${html}`
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
