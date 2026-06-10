# Self‑Hosting Guide — ABC Glance (with hosted Supabase)

This guide walks you through running the ABC Glance **frontend** on your own server
while using **Supabase Cloud** (the hosted, managed Supabase at supabase.com) as the
backend. You get full control of the web app and TLS, without operating Postgres,
Auth, Storage, Realtime, or Edge Functions yourself.

Contents:

1. Server prerequisites
2. Directory layout (where every file lives)
3. Create & configure your hosted Supabase project
4. Apply migrations and deploy edge functions to Supabase Cloud
5. Build & deploy the React frontend
6. NGINX reverse‑proxy + HTTPS (Let's Encrypt)
7. First‑run admin bootstrap (and emergency recovery)
8. Updating, backups, troubleshooting

> Target OS for the examples: **Ubuntu 22.04 / 24.04 LTS**. Anything Linux works —
> adjust package names accordingly.

---

## 1. Prerequisites

### 1.1 Accounts

| Service | Why |
|---------|-----|
| **Supabase Cloud** (supabase.com) | Hosted Postgres, Auth, Storage, Realtime, Edge Functions |
| **Resend** (or any SMTP) | Optional — outbound email (daily reports, callouts) |
| Domain registrar | DNS for `glance.example.com` |

Create a free Supabase project at <https://supabase.com/dashboard> before continuing.
Note the **Project Ref** (the subdomain, e.g. `abcdwxyz` in `abcdwxyz.supabase.co`),
the **anon / publishable key**, and the **service_role key** — you'll need all three.

### 1.2 Server packages

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | ≥ 20.x (LTS) | Build the frontend |
| Bun *(optional)* | ≥ 1.1 | Faster install/build |
| NGINX | ≥ 1.22 | Reverse proxy + TLS termination |
| Certbot | latest | Free Let's Encrypt certificates |
| Git | any | Clone the repo |
| Supabase CLI | ≥ 1.200 | Deploys edge functions & migrations to Supabase Cloud |

Install everything:

```bash
# Node 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun (optional but recommended — the project uses bun.lock)
curl -fsSL https://bun.sh/install | bash

# NGINX + Certbot + Git
sudo apt-get install -y nginx certbot python3-certbot-nginx git

# Supabase CLI
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
  | sudo tar -xz -C /usr/local/bin supabase
```

### 1.3 DNS

Point one A‑record at your server's public IP **before** requesting certificates:

| Host | Purpose |
|------|---------|
| `glance.example.com` | The React app |

The backend lives at `https://<project-ref>.supabase.co` — Supabase owns that
hostname and TLS, so you do not configure it.

---

## 2. Recommended directory layout

```
/srv/abc-glance/
└── app/                       ← git clone of this repo
    ├── dist/                  ← built static frontend (output of `bun run build`)
    ├── supabase/              ← migrations + edge functions (shipped with the repo)
    └── .env.production        ← VITE_* build‑time variables (see §5)
```

NGINX config lives under `/etc/nginx/sites-available/`. TLS certs are written to
`/etc/letsencrypt/live/<host>/`. Static frontend files are served from
`/srv/abc-glance/app/dist/` directly by NGINX.

Create the tree:

```bash
sudo mkdir -p /srv/abc-glance/app
sudo chown -R $USER:$USER /srv/abc-glance
cd /srv/abc-glance
```

---

## 3. Configure your hosted Supabase project

In the Supabase dashboard for your new project:

### 3.1 Auth settings

- **Authentication → URL Configuration**
  - **Site URL**: `https://glance.example.com`
  - **Additional redirect URLs**: `https://glance.example.com/*`
- **Authentication → Providers → Email**: enabled. Disable "Confirm email" if you
  want immediate sign‑in for the bootstrap admin; otherwise leave it on.
- **Authentication → SMTP** (optional): plug in your Resend / SES / SMTP credentials
  so password reset and confirmation mails are sent from your domain.

### 3.2 Storage buckets

The app uses two public buckets (created automatically by the migrations):

| Bucket | Public? | Used for |
|--------|---------|----------|
| `branding` | yes | Org logos, hero images |
| `camera-snapshots` | yes | Camera thumbnails |

If migrations don't create them for some reason, create them manually under
**Storage → Buckets** with public read enabled.

### 3.3 Grab the keys

From **Project Settings → API**:

- `Project URL` → e.g. `https://abcdwxyz.supabase.co`
- `anon` / `publishable` key → safe to ship in the frontend
- `service_role` key → **secret** (used only by edge functions)

You'll paste these into `.env.production` (§5) and the edge function secrets (§4.2).

---

## 4. Apply migrations & deploy edge functions to Supabase Cloud

### 4.1 Clone the repo & link the project

```bash
cd /srv/abc-glance
git clone https://github.com/<your-fork>/abc-glance.git app
cd app

# Authenticate the CLI (opens a browser, or paste a PAT)
supabase login

# Link this local copy to your hosted project
supabase link --project-ref <your-project-ref>
```

Push the migrations:

```bash
supabase db push
```

This applies everything in `supabase/migrations/` to your hosted database, creating
tables, RLS policies, helper functions, and the storage buckets.

### 4.2 Edge functions

The repo ships these functions under `supabase/functions/`:

```
admin-users              callout-request         camera-watch
arm-scheduler            callout-resolved        daily-report-send
escalate-offline         frigate-poll            frigate-proxy
super-callout-email      webhook-ingest          _shared/
```

Deploy them all:

```bash
cd /srv/abc-glance/app

for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" --no-verify-jwt
done
```

### 4.3 Edge function secrets

Set these via **Project Settings → Edge Functions → Secrets** in the Supabase
dashboard, or via the CLI:

```bash
supabase secrets set \
  SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_ANON_KEY=<anon key> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  RESEND_API_KEY=<optional> \
  EMERGENCY_USER=admin \
  EMERGENCY_PASS=<rotate this in production>
```

| Secret | Required? | What it does |
|--------|-----------|--------------|
| `SUPABASE_URL` | yes | Same as your project URL |
| `SUPABASE_ANON_KEY` | yes | For client‑style calls inside functions |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Admin operations (users, RLS bypass) |
| `RESEND_API_KEY` | recommended | Email (daily reports, callouts, alerts) |
| `EMERGENCY_USER` | optional | Override emergency login username (default `admin`) |
| `EMERGENCY_PASS` | optional | Override emergency password (default `Abcsec2008`) |
| `LOVABLE_API_KEY` | optional | Only if you keep using Lovable AI Gateway |

> **Change `EMERGENCY_PASS` in production.** The default exists only to bootstrap a
> brand new install. Redeploy `admin-users` after rotating it.

---

## 5. Build & deploy the frontend

### 5.1 Configure

Create `/srv/abc-glance/app/.env.production`:

```ini
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
VITE_SUPABASE_PROJECT_ID=<project-ref>
```

> These three variables are **baked into the JS bundle at build time**. Rebuild after
> any change.

### 5.2 Build

```bash
cd /srv/abc-glance/app
bun install            # or: npm ci
bun run build          # outputs to ./dist
```

Result: `/srv/abc-glance/app/dist/` contains `index.html`, `assets/*.js`,
`assets/*.css`, plus the `public/` files. NGINX serves this folder.

### 5.3 Updating later

```bash
cd /srv/abc-glance/app
git pull
bun install
bun run build
# Apply any new migrations / functions:
supabase db push
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" --no-verify-jwt
done
sudo systemctl reload nginx     # harmless even if not strictly required
```

---

## 6. NGINX

You only need **one** server block — the backend is on Supabase, not on this server.

### 6.1 Frontend site — `/etc/nginx/sites-available/glance.conf`

```nginx
server {
    listen 80;
    server_name glance.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name glance.example.com;

    ssl_certificate     /etc/letsencrypt/live/glance.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/glance.example.com/privkey.pem;

    root /srv/abc-glance/app/dist;
    index index.html;

    # SPA fallback — React Router handles /login, /archive, /offline, etc.
    location / {
        try_files $uri /index.html;
    }

    # Cache hashed assets aggressively, never cache index.html
    location ~* \.(?:js|css|woff2?|svg|png|jpg|jpeg|gif|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location = /index.html {
        add_header Cache-Control "no-store";
    }

    client_max_body_size 25M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
}
```

### 6.2 Enable & issue TLS

```bash
sudo ln -s /etc/nginx/sites-available/glance.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d glance.example.com \
     --redirect --agree-tos -m ops@example.com
```

Certbot's systemd timer auto‑renews. Verify with `sudo certbot renew --dry-run`.

---

## 7. First‑run admin bootstrap

The app bootstraps itself the first time you visit it against an empty database.

1. Open `https://glance.example.com/login`.
2. The login page calls `admin-users/seed?check_only=true`. On a fresh database it
   returns `needs_password: true` and the form switches to **"Create admin account"**.
3. Username is locked to `admin`. Enter a password (min 8 chars) and submit.
4. You're signed in and redirected to the dashboard. The "create admin" form will
   not re‑appear (the public endpoint refuses to overwrite an existing admin).

### 7.1 Recovery — if step 2 fails or you lose the password

Go to `https://glance.example.com/offline`. The page exposes two tools that talk
directly to the `admin-users` edge function using the emergency credentials:

- **Create / reset admin account** — uses `admin-users/emergency-reset` to rebuild
  the `admin` profile, role rows, and organization membership; then sets a new
  password.
- **Force create / repair admin account** — same endpoint, called with the default
  emergency credentials (`admin / Abcsec2008` unless you set `EMERGENCY_USER` /
  `EMERGENCY_PASS`). Use this when the seed check itself is broken.

After recovery, **rotate `EMERGENCY_PASS`** via Supabase function secrets and
redeploy the `admin-users` function:

```bash
supabase secrets set EMERGENCY_PASS=<new strong value>
supabase functions deploy admin-users --no-verify-jwt
```

---

## 7a. Scheduled jobs (pg_cron)

Several edge functions are **expected to run on a schedule** — they are not
triggered by user actions. Without these the app appears to work but:

- NVR status stays **Pending** and no events are ever pulled (`frigate-poll`)
- Camera arm/disarm schedules never fire (`arm-scheduler`)
- "Camera offline" alerts and escalations never go out (`camera-watch`, `escalate-offline`)
- Daily reports never send (`daily-report-send`)

On Lovable Cloud these are pre-scheduled. **On self-hosted Supabase you must
schedule them yourself** with `pg_cron` + `pg_net`. Run this once in psql
against your self-hosted DB:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace these two values:
--   <FUNCTIONS_URL>     e.g. https://supabase.example.com/functions/v1
--   <SERVICE_ROLE_KEY>  the project's service_role JWT
do $$
declare
  base text := '<FUNCTIONS_URL>';
  key  text := '<SERVICE_ROLE_KEY>';
begin
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('frigate-poll','arm-scheduler','camera-watch',
                     'escalate-offline','daily-report-send');

  perform cron.schedule('frigate-poll', '* * * * *', format($f$
    select net.http_post(url:=%L, headers:=jsonb_build_object(
      'Authorization','Bearer %s','Content-Type','application/json'),
      body:='{}'::jsonb) $f$, base||'/frigate-poll', key));

  perform cron.schedule('arm-scheduler', '* * * * *', format($f$
    select net.http_post(url:=%L, headers:=jsonb_build_object(
      'Authorization','Bearer %s','Content-Type','application/json'),
      body:='{}'::jsonb) $f$, base||'/arm-scheduler', key));

  perform cron.schedule('camera-watch', '* * * * *', format($f$
    select net.http_post(url:=%L, headers:=jsonb_build_object(
      'Authorization','Bearer %s','Content-Type','application/json'),
      body:='{}'::jsonb) $f$, base||'/camera-watch', key));

  perform cron.schedule('escalate-offline', '*/5 * * * *', format($f$
    select net.http_post(url:=%L, headers:=jsonb_build_object(
      'Authorization','Bearer %s','Content-Type','application/json'),
      body:='{}'::jsonb) $f$, base||'/escalate-offline', key));

  perform cron.schedule('daily-report-send', '*/5 * * * *', format($f$
    select net.http_post(url:=%L, headers:=jsonb_build_object(
      'Authorization','Bearer %s','Content-Type','application/json'),
      body:='{}'::jsonb) $f$, base||'/daily-report-send', key));
end $$;

select jobname, schedule, active from cron.job order by jobname;
```

### Sanity-check manually

After adding an NVR, fire the poller once instead of waiting a minute:

```bash
curl -i -X POST \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  https://supabase.example.com/functions/v1/frigate-poll
```

The response includes per-instance `events` / `reviews` / `media` counts, or
an `error` string if the Supabase host can't reach the NVR. After a successful
run the **Frigate** page badge flips from **Pending** → **Healthy** and
events start appearing.

### Inspect cron history

```sql
select * from cron.job_run_details order by start_time desc limit 20;
```

---

## 7b. WhatsApp alerts via Mudslide (optional)

Run [Mudslide](https://github.com/robvanbentem/mudslide) on your Linux server to
send offline-NVR / offline-camera alerts to WhatsApp **without** Twilio or Meta
Business approval. Mudslide is a thin HTTP wrapper around `whatsapp-web.js` —
you scan a QR code once, and it keeps a WhatsApp Web session alive that the
`escalate-offline-whatsapp` edge function POSTs to.

> Unofficial transport (uses WhatsApp Web under the hood). Fine for a handful
> of alerts per day from a dedicated number. Don't blast high volume — numbers
> can get banned. Use Twilio/Meta if you need guaranteed delivery at scale.

### 7b.1 Install Mudslide

On the same server (or any reachable Linux box):

```bash
sudo npm i -g mudslide
mudslide login         # scan the QR with the WhatsApp account that will send alerts
mudslide me            # confirms which account is logged in
```

The session is stored under `~/.mudslide/` — back this directory up so a
server rebuild doesn't force a new QR scan.

### 7b.2 Run it as a systemd service

`/etc/systemd/system/mudslide.service`:

```ini
[Unit]
Description=Mudslide WhatsApp daemon
After=network-online.target

[Service]
ExecStart=/usr/bin/mudslide daemon --port 3000
Restart=always
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mudslide
sudo systemctl status mudslide
```

Mudslide is now listening on `127.0.0.1:3000`. Don't expose port 3000 directly —
it has no auth of its own.

### 7b.3 Put it behind NGINX + a bearer token

Pick a random token (`openssl rand -hex 32`) — this is what the edge function
will send in `Authorization: Bearer ...`.

`/etc/nginx/sites-available/mudslide.conf`:

```nginx
server {
    listen 80;
    server_name wa.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wa.example.com;

    ssl_certificate     /etc/letsencrypt/live/wa.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wa.example.com/privkey.pem;

    # Require the bearer token on every request
    if ($http_authorization != "Bearer REPLACE_WITH_LONG_RANDOM_TOKEN") {
        return 401;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mudslide.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d wa.example.com --redirect --agree-tos -m ops@example.com
```

Test from anywhere:

```bash
curl -i -X POST https://wa.example.com/send-message \
  -H "Authorization: Bearer REPLACE_WITH_LONG_RANDOM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"+27821234567","message":"Mudslide test from ABC Glance"}'
```

You should receive the WhatsApp message within a couple of seconds.

### 7b.4 Wire it into Supabase

Add two function secrets in your hosted Supabase project (Project Settings →
Edge Functions → Secrets), or via CLI:

```bash
supabase secrets set \
  MUDSLIDE_URL=https://wa.example.com \
  MUDSLIDE_TOKEN=REPLACE_WITH_LONG_RANDOM_TOKEN
```

| Secret | Purpose |
|--------|---------|
| `MUDSLIDE_URL` | Public HTTPS URL of your Mudslide proxy (no trailing slash) |
| `MUDSLIDE_TOKEN` | The bearer token you put in the NGINX `if` check |

Once these are set and the `escalate-offline-whatsapp` function + NVR UI toggle
have been deployed (shipped with the repo when the WhatsApp feature lands), the
`camera-watch` cron job will fan out offline alerts to both email and WhatsApp
without sending duplicates — dedupe still goes through `camera_offline_alerts`.

### 7b.5 Operational tips

- Use a **dedicated** WhatsApp number for alerts. Don't reuse a personal one.
- Recipients must be in **E.164** format (e.g. `+27821234567`).
- If the session drops (long server downtime, phone logged out), run
  `mudslide login` again on the server to re-scan.
- Tail logs while debugging: `journalctl -u mudslide -f`.
- Back up `~/.mudslide/` along with your DB dumps.

---





## 8. Backups, upgrades, troubleshooting

### 8.1 Backups

Supabase Cloud takes **automatic daily backups** of your database on paid plans;
free projects can use **Project Settings → Database → Backups** to trigger
on‑demand snapshots, or run `pg_dump` against the connection string in
**Project Settings → Database → Connection string**:

```bash
# Example: nightly local dump via cron
pg_dump "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  | gzip > /srv/abc-glance/backups/db-$(date +%F).sql.gz
```

Storage objects are stored in Supabase Storage; for a full disaster‑recovery copy,
either rely on Supabase's bucket replication (paid plans) or sync the buckets with
the Storage API / `supabase storage cp` periodically.

### 8.2 Updating the app

```bash
cd /srv/abc-glance/app
git pull
bun install
bun run build
supabase db push
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" --no-verify-jwt
done
```

### 8.3 Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Login page never switches to "create admin" | Edge function `admin-users` not deployed | `supabase functions deploy admin-users --no-verify-jwt` |
| 401 / "Invalid JWT" on every request | `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.production` doesn't match the project's anon key | Rebuild frontend with the correct key |
| Auth callbacks redirect to localhost | **Site URL** / **Additional redirect URLs** not updated in Supabase Auth | Set them to `https://glance.example.com` |
| Realtime never connects | Browser blocked by a proxy / Supabase project paused | Check Supabase dashboard project status; whitelist `*.supabase.co` |
| Camera snapshots fail to upload | `client_max_body_size` too low | Raise it in the NGINX server block |
| Edge functions can't reach the NVR | Function runs on Supabase's edge network with no LAN access | Expose the NVR publicly (with auth) or run `frigate-poll` from a worker inside your LAN |
| Daily report emails don't arrive | `RESEND_API_KEY` unset | Set it under Edge Function Secrets, redeploy `daily-report-send` |

### 8.4 Useful one‑liners

```bash
# Tail edge function logs (Supabase Cloud)
supabase functions logs admin-users --tail

# Open a psql shell against the hosted DB
psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"

# Re-deploy a single function
supabase functions deploy admin-users --no-verify-jwt
```

---

## Appendix A — Minimal checklist

- [ ] Supabase Cloud project created; project ref, anon key, service_role key noted
- [ ] DNS A record for `glance.example.com`
- [ ] Node 20 + NGINX + Certbot + Supabase CLI installed
- [ ] Auth **Site URL** and redirect URLs set to your domain
- [ ] `supabase link` + `supabase db push` succeeded (migrations applied)
- [ ] All edge functions deployed, function secrets set
- [ ] `/srv/abc-glance/app/.env.production` filled in
- [ ] `bun run build` produced `dist/`
- [ ] NGINX site enabled, TLS issued
- [ ] First‑run admin created at `/login`
- [ ] `EMERGENCY_PASS` rotated, backup strategy in place
