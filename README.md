# Dead Concrete

Streetwear storefront — Resurrection tees, Stand Tops. Built with Express, SQLite, and a single-page React frontend (no build step).

## Local development

```bash
npm install
cp .env.example .env       # then edit the values
npm run setup              # seeds products + admin user
npm start                  # http://localhost:3000
```

Default admin: `admin@deadconcrete.com / admin123`.
Skip the demo customer with `SEED_DEMO=false npm run setup`.

## Deploying to Render

1. Push this repo to GitHub.
2. [render.com](https://render.com) → **New +** → **Blueprint** → connect this repo. Render reads `render.yaml` automatically.
3. After the service is created, open it → **Environment** tab → fill in the variables marked `sync: false` (Paystack keys, Resend key, Google client ID, MoMo & Bank details, `SITE_URL`).
4. Set `SITE_URL` to your Render URL (e.g. `https://dead-concrete.onrender.com`) or your custom domain.

### After deploy
- Set the **Paystack webhook URL** at <https://dashboard.paystack.com/#/settings/developers> to `https://YOUR-URL/webhooks/paystack`.
- Add your production URL to **Authorized JavaScript origins** in the Google OAuth client at <https://console.cloud.google.com/apis/credentials>.
- The free Render plan has **no persistent disk** — every redeploy re-runs `npm run setup`, which wipes the database. For real customer data, upgrade to a paid plan with a disk, or migrate to Postgres.

## API surface

Auth: `POST /api/auth/register|login|forgot-password|reset-password|google`, `GET /api/auth/me`, `PUT /api/auth/profile`

Storefront: `GET /api/products`, `GET /api/orders/track/:id`, `GET /api/orders/my` (auth), `POST /api/payments/momo|bank`, `POST /api/contact`, `GET|POST /api/reviews`

Admin (`role=admin`): `POST|PUT|DELETE /api/products`, `GET /api/orders`, `PATCH /api/orders/:id/status`, `GET /api/admin/stats`, `GET|PATCH /api/contact`, `GET|PATCH /api/reviews/pending`

Webhook: `POST /webhooks/paystack` · Health: `GET /healthz`
