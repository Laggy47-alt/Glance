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
```

The values come from the Supabase dashboard → **Project Settings → API**.

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
- Required edge-function secrets: `RESEND_API_KEY`, `LOVABLE_API_KEY`
  (set in Supabase dashboard → Edge Functions → Secrets)

To deploy migrations and functions to your own project:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push                # apply migrations
supabase functions deploy       # deploy all edge functions
```

## 5. Emergency super-admin access

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

## 6. Updating

Pull new code, re-run `npm install && npm run build`, and copy `dist/` over
your existing webroot. Re-run `supabase db push` / `supabase functions deploy`
if backend changes are included.
