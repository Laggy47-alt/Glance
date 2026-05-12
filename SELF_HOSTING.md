# Self-Hosting Guide

This app is a standard Vite + React SPA backed by Supabase. You can copy the
codebase to any server and host it yourself.

## 1. What you need

- **Node.js 20+** (or Bun) on the build machine.
- A **Supabase project** — either:
  - the existing Lovable Cloud project (use its URL + anon key), or
  - your own Supabase project (cloud or self-hosted via the
    [Supabase self-hosting guide](https://supabase.com/docs/guides/self-hosting)).
- Static-file hosting for the built frontend (Nginx, Caddy, Apache, S3 +
  CloudFront, Netlify, Vercel, etc.).

## 2. Configure environment

```bash
cp .env.example .env
# then edit .env and fill in:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_PUBLISHABLE_KEY
#   VITE_SUPABASE_PROJECT_ID
#   VITE_PAYMENTS_CLIENT_TOKEN   # Paddle client token (test_... for sandbox, live_... for production)
```

The Supabase values come from the Supabase dashboard → **Project Settings → API**.

The Paddle client token comes from the Paddle dashboard → **Developer Tools → Authentication**.
Use a `test_` token for sandbox checkout and a `live_` token for production.

## 3. Build the frontend

```bash
npm install
npm run build
# output is in dist/
```

`dist/` is a static bundle — serve it with any web server.

### Example: Nginx

```nginx
server {
  listen 80;
  server_name app.example.com;
  root /var/www/glance/dist;
  index index.html;

  # SPA fallback — all unknown routes serve index.html
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### Example: Caddy

```
app.example.com {
  root * /var/www/glance/dist
  try_files {path} /index.html
  file_server
}
```

### Example: Docker (nginx)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
  listen 80;
  root /usr/share/nginx/html;
  location / { try_files $uri /index.html; }
}
EOF
```

## 4. Backend (Supabase)

The app expects these to exist in the connected Supabase project:

- All tables/functions/policies under `supabase/migrations/`
- Edge functions under `supabase/functions/`
- Storage buckets: `branding`, `camera-snapshots`
- Required edge-function secrets (set in Supabase dashboard → **Edge Functions → Secrets**):

| Secret | Required by | Source |
|--------|-------------|--------|
| `SUPABASE_URL` | Most functions | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Most functions | Supabase dashboard → Project Settings → API |
| `SUPABASE_ANON_KEY` | `admin-users` function | Supabase dashboard → Project Settings → API |
| `LOVABLE_API_KEY` | Paddle shared code | Lovable project settings |
| `RESEND_API_KEY` | Email functions | [Resend](https://resend.com) dashboard |
| `PADDLE_SANDBOX_API_KEY` | Paddle shared code | Paddle dashboard → Developer Tools |
| `PADDLE_LIVE_API_KEY` | Paddle shared code | Paddle dashboard → Developer Tools |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | `payments-webhook` | Paddle sandbox webhook settings |
| `PAYMENTS_LIVE_WEBHOOK_SECRET` | `payments-webhook` | Paddle live webhook settings |

To deploy migrations and functions to your own project:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push                # apply migrations
supabase functions deploy       # deploy all edge functions
```

## 5. Payments (Paddle) configuration

If you are using the built-in subscription billing:

1. Create your products and prices in the **Paddle dashboard**.
2. Map them to the app's price IDs via the `get-paddle-price` edge function or
   by inserting rows into the `price_mappings` table (see `supabase/migrations/`).
3. Set the correct `VITE_PAYMENTS_CLIENT_TOKEN` in your frontend `.env`.
4. Configure the Paddle webhook to point at:
   `https://<your-project>.supabase.co/functions/v1/payments-webhook?env=sandbox`
   (or `env=live` for production).

## 6. Emergency super-admin access

This app ships with an offline diagnostics page at **`/offline`** that is
always reachable, even when the backend is down or misconfigured. Sign in
with the emergency super-admin credentials baked into
`src/lib/offlineMode.ts`. You can change the username and password hash
there before building.

To generate a new SHA-256 password hash:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('YOUR_NEW_PASSWORD').digest('hex'))"
```

Replace `EMERGENCY_USERNAME` and `EMERGENCY_PASSWORD_SHA256` in
`src/lib/offlineMode.ts`, then rebuild.

## 7. Updating

Pull new code, re-run `npm install && npm run build`, and copy `dist/` over
your existing webroot. Re-run `supabase db push` / `supabase functions deploy`
if backend changes are included.
