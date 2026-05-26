# Self-Hosting Guide — Glance

This guide walks you end-to-end through hosting the Glance app on your own
infrastructure. Two paths are supported:

- **Path A — Cloud Supabase** (recommended, fastest): keep using a managed
  Supabase project (or create your own free one) and host only the static
  frontend yourself.
- **Path B — Fully self-hosted Supabase**: run Postgres + Supabase services
  on your own server alongside the frontend.

If you follow either path top-to-bottom, the app will work — including first-run
admin setup, Frigate NVR ingest, and the offline emergency console.

---

## 0. Emergency admin diagnostics (works even when backend is down)

The app ships with a baked-in offline diagnostics login you can use from the normal
login screen **at any time** — even on a fresh deploy or when the database
is unreachable:

| Username | Password    |
|----------|-------------|
| `admin`  | `Abcsec2008`|

Signing in with one of these is a **client-only** session that routes you to
`/offline` (diagnostics). It does not touch the database. Use it to verify
the bundle is deployed correctly and to debug backend connectivity.

To change these credentials, edit `src/lib/offlineMode.ts` and rebuild.

---

## 1. Prerequisites

- **Node.js 20+** (or Bun) on the build machine.
- A web server to serve static files (Nginx, Caddy, Apache, Docker+nginx,
  S3+CloudFront, Netlify, Vercel — anything that can serve a folder with
  SPA fallback).
- One of:
  - A **Cloud Supabase** project (free tier works), **or**
  - A server (Linux, 2+ CPU, 4 GB RAM minimum) for self-hosted Supabase.
- The **Supabase CLI** for deploying migrations and edge functions:
  ```bash
  npm install -g supabase
  supabase login    # only needed for cloud projects
  ```

---

# Path A — Cloud Supabase

### A1. Create / pick your Supabase project

1. Go to https://supabase.com → **New project**.
2. Note down:
   - Project URL (e.g. `https://abcd1234.supabase.co`)
   - **Project ref** (the `abcd1234` part)
   - **Anon / publishable key** (Project Settings → API)
   - **Service role key** (keep secret — server-side only)

### A2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
VITE_SUPABASE_PROJECT_ID=<your-project-ref>
```

### A3. Push the database schema

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This applies every migration under `supabase/migrations/` to your project.

### A4. Deploy edge functions

```bash
# Deploy every function in supabase/functions/
supabase functions deploy --project-ref <your-project-ref>
```

The `supabase/config.toml` in this repo already sets `verify_jwt = false`
for the functions that need it (webhook ingest, Frigate proxy/poll, cron
jobs, etc.). The CLI honors that file — no extra flags needed.

### A5. Set edge function secrets

In the Supabase dashboard → **Edge Functions → Secrets**, add:

| Secret                        | Required for                       | Where to get it                                  |
|-------------------------------|------------------------------------|--------------------------------------------------|
| `SUPABASE_URL`                | all functions                      | already auto-set on cloud Supabase               |
| `SUPABASE_SERVICE_ROLE_KEY`   | all functions                      | already auto-set on cloud Supabase               |
| `SUPABASE_ANON_KEY`           | `admin-users`                      | already auto-set on cloud Supabase               |
| `RESEND_API_KEY`              | email (daily report, callouts)     | https://resend.com → API Keys                    |

The `SUPABASE_*` ones are injected automatically by the Supabase platform on
cloud — only add `RESEND_API_KEY` manually if you want email sending.

### A6. Create storage buckets

In the Supabase dashboard → **Storage**, create two **public** buckets:

- `branding`
- `camera-snapshots`

(Or run, from `psql` connected to the database:)

```sql
insert into storage.buckets (id, name, public) values
  ('branding', 'branding', true),
  ('camera-snapshots', 'camera-snapshots', true)
on conflict do nothing;
```

### A7. Schedule cron jobs (optional but recommended)

The app uses pg_cron to poll Frigate, run the arm scheduler, etc. Run this
once in the Supabase SQL editor (replace `<URL>` and `<SERVICE_KEY>`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Poll Frigate every 30 seconds
select cron.schedule('frigate-poll', '*/1 * * * *', $$
  select net.http_post(
    url := '<URL>/functions/v1/frigate-poll',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_KEY>')
  );
$$);

-- Arm/disarm scheduler — every minute
select cron.schedule('arm-scheduler', '*/1 * * * *', $$
  select net.http_post(
    url := '<URL>/functions/v1/arm-scheduler',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_KEY>')
  );
$$);

-- Daily report — hourly check (function decides when to send)
select cron.schedule('daily-report', '0 * * * *', $$
  select net.http_post(
    url := '<URL>/functions/v1/daily-report-send',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_KEY>')
  );
$$);

-- Camera watch — every minute. Maintains live camera online/offline
-- status (so the daily report shows real offline durations) and sends
-- per-NVR offline alerts to assigned customers.
select cron.schedule('camera-watch', '*/1 * * * *', $$
  select net.http_post(
    url := '<URL>/functions/v1/camera-watch',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_KEY>')
  );
$$);
```

### A8. Build & serve the frontend

```bash
npm install
npm run build
# dist/ is a static bundle — serve it however you like
```

#### Nginx example

```nginx
server {
  listen 80;
  server_name app.example.com;
  root /var/www/glance/dist;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
```

#### Caddy example

```
app.example.com {
  root * /var/www/glance/dist
  try_files {path} /index.html
  file_server
}
```

#### Docker (nginx) example

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri /index.html; } }' \
    > /etc/nginx/conf.d/default.conf
```

### A9. First login

1. Browse to your deployed URL.
2. If this is a fresh backend, the login screen will show **Create the first admin password**.
3. Leave the username as `admin`, choose your own secure password, and submit.
4. The app creates the default admin account and signs you in.

The setup flow never creates or restores a known default backend password.
If the `admin` account already exists, the app only shows the normal sign-in
form and **will not reset that password**. From there you can:

- Open **Users** → create real accounts.
- Open **Sources** → add an NVR / webhook source.
- Change the `admin` password under **Change Password** when needed.

If the frontend cannot reach the setup screen yet, create the first admin
directly after deploying edge functions:

```bash
curl -X POST "https://<your-supabase-url>/functions/v1/admin-users/seed" \
  -H "Content-Type: application/json" \
  -d '{"password":"choose-a-long-secure-password"}'
```

Then sign in on the app as username `admin` with the password you chose.

---

# Path B — Fully self-hosted Supabase

This runs Postgres + GoTrue (auth) + PostgREST + Realtime + Storage +
Edge Runtime on your own server.

### B1. Install Supabase (Docker Compose)

Follow the official guide: https://supabase.com/docs/guides/self-hosting/docker

TL;DR:

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# edit .env — set POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY,
# SITE_URL, API_EXTERNAL_URL (https://supabase.your-domain.com)
docker compose up -d
```

After it starts:
- Studio (admin UI): `http://your-server:8000`
- API gateway (Kong): `http://your-server:8000` (REST/auth/storage all live here)

Put it behind HTTPS (Caddy / nginx with Let's Encrypt). The frontend **must**
be able to reach Supabase over HTTPS if the frontend itself is on HTTPS
(browsers block mixed content).

### B2. Generate keys

The Supabase docker `.env` includes a `JWT_SECRET`. Generate the matching
`ANON_KEY` and `SERVICE_ROLE_KEY` with the helper at
https://supabase.com/docs/guides/self-hosting/docker#api-keys (or use any
JWT signer with the secret).

### B3. Point the app at your Supabase

Edit the project's `.env`:

```env
VITE_SUPABASE_URL=https://supabase.your-domain.com
VITE_SUPABASE_PUBLISHABLE_KEY=<your ANON_KEY>
VITE_SUPABASE_PROJECT_ID=self-hosted
```

### B4. Apply migrations

Connect with psql (or any client) and run every file in
`supabase/migrations/` in order:

```bash
export DB_URL='postgres://postgres:<password>@your-server:5432/postgres'
for f in supabase/migrations/*.sql; do
  echo ">> $f"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Or, if you have the Supabase CLI configured against your self-hosted DB:

```bash
supabase db push --db-url "$DB_URL"
```

### B5. Deploy edge functions

Self-hosted Supabase ships an Edge Runtime container. Deploy each function:

```bash
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" \
    --project-ref self-hosted \
    --no-verify-jwt    # or rely on supabase/config.toml
done
```

> **Important:** the included `supabase/config.toml` already sets
> `verify_jwt = false` for `webhook-ingest`, `frigate-proxy`,
> `frigate-poll`, `arm-scheduler`, `escalate-offline`, `admin-users`,
> `callout-request`, `callout-resolved`, `daily-report-send`, and
> `super-callout-email`. If you don't deploy with the config.toml, pass
> `--no-verify-jwt` manually for those functions, otherwise the Frigate
> integration will return **401 Unauthorized** when the cron job calls
> `frigate-poll`.

### B6. Set edge function secrets

In your Supabase Studio → **Edge Functions → Secrets** (or via the CLI):

```bash
supabase secrets set \
  SUPABASE_URL=https://supabase.your-domain.com \
  SUPABASE_ANON_KEY=<anon key> \
  SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  RESEND_API_KEY=<optional, for email>
```

### B7. Storage buckets

```sql
insert into storage.buckets (id, name, public) values
  ('branding', 'branding', true),
  ('camera-snapshots', 'camera-snapshots', true)
on conflict do nothing;
```

### B8. Cron jobs

Same SQL as **A7** above — run it against your self-hosted database. `pg_cron`
and `pg_net` are included in the Supabase Docker image.

### B9. Build, deploy, log in

Same as **A8** and **A9**.

---

## 3. Adding a Frigate NVR

1. Sign in as `admin`.
2. Go to **Sources** — note the webhook URL shown (it auto-uses your
   configured Supabase URL).
3. Configure `frigate-notify` on your NVR to POST to that webhook URL.
4. Go to **Frigate** → **Add NVR**, fill in:
   - Name, color
   - Base URL (e.g. `http://192.168.1.50:5000` for local, or
     `https://frigate.your-domain.com` via cloudflared)
   - API key (if your Frigate has auth enabled — required for newer Frigate
     versions; the proxy will get **401** without it)
5. The app immediately triggers a poll. Cameras and statuses will populate
   from the first event Frigate reports.

**Troubleshooting 401 from Frigate:**
- Your Frigate has authentication enabled and the **API key field is empty**
  or wrong — fill it in.
- You self-hosted Supabase and deployed `frigate-poll` *with* JWT
  verification — redeploy with `--no-verify-jwt` (or use the included
  `supabase/config.toml`). pg_cron calls the function without a JWT.

---

## 4. Updating

```bash
git pull
npm install
npm run build
# copy dist/ to your webroot

# If backend changes are included:
supabase db push
supabase functions deploy
```

---

## 5. Troubleshooting checklist

| Symptom                                         | Fix                                                                                       |
|-------------------------------------------------|-------------------------------------------------------------------------------------------|
| Fresh install does not show first admin setup     | Confirm `admin-users` was deployed with `verify_jwt = false`, then reload `/login`. If the account already exists, use the password you created previously. |
| Page won't load at all / loops on `/offline`    | Backend unreachable. Sign in with `admin/Abcsec2008` to access diagnostics.               |
| Frigate NVR returns 401                         | See §3 troubleshooting above.                                                             |
| Webhook URL still points at the wrong Supabase  | Confirm `VITE_SUPABASE_URL` is set in `.env` before `npm run build`, then rebuild.        |
| HTTPS site can't reach HTTP Supabase            | Browsers block mixed content. Put Supabase behind HTTPS too (Caddy/nginx + Let's Encrypt). |
| Deep links 404 on refresh                       | Add SPA fallback (`try_files ... /index.html`) to your web server config.                 |
