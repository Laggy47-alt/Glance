# Self‑Hosting Guide — ABC Glance

This guide walks you through running the **entire** ABC Glance stack on your own server
(no Lovable Cloud, no managed Supabase). It covers:

1. Server prerequisites
2. Directory layout (where every file lives)
3. Installing self‑hosted Supabase
4. Building & deploying the React frontend
5. Deploying the Edge Functions
6. NGINX reverse‑proxy + HTTPS (Let's Encrypt)
7. First‑run admin bootstrap (and emergency recovery)
8. Updating, backups, troubleshooting

> Target OS for the examples: **Ubuntu 22.04 / 24.04 LTS**. Anything Linux with Docker
> works — adjust package names accordingly.

---

## 1. Prerequisites

On your server:

| Component | Version | Purpose |
|-----------|---------|---------|
| Docker Engine | ≥ 24.x | Runs Supabase |
| Docker Compose plugin | ≥ 2.x | Orchestrates Supabase services |
| Node.js | ≥ 20.x (LTS) | Build the frontend |
| Bun *(optional)* | ≥ 1.1 | Faster install/build |
| NGINX | ≥ 1.22 | Reverse proxy + TLS termination |
| Certbot | latest | Free Let's Encrypt certificates |
| Git | any | Clone the repo |
| Supabase CLI | ≥ 1.200 | Deploys edge functions & migrations |

Install everything:

```bash
# Docker + Compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER       # log out / back in after this

# Node 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun (optional but recommended — the project uses bun.lock)
curl -fsSL https://bun.sh/install | bash

# NGINX + Certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx git

# Supabase CLI
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
  | sudo tar -xz -C /usr/local/bin supabase
```

### Network / DNS

Point two A‑records at your server's public IP **before** requesting certificates:

| Host | Purpose |
|------|---------|
| `glance.example.com` | The React app |
| `api.example.com` | Supabase (Postgres REST, Auth, Storage, Edge Functions) |

You can host both on one machine. NGINX will route by hostname.

---

## 2. Recommended directory layout

Pick a parent directory and stick with it. The rest of the guide assumes:

```
/srv/abc-glance/
├── app/                       ← git clone of this repo
│   ├── dist/                  ← built static frontend (output of `bun run build`)
│   ├── supabase/              ← migrations + edge functions (shipped with the repo)
│   └── .env.production        ← VITE_* build‑time variables (see §4)
│
├── supabase/                  ← self‑hosted Supabase (docker‑compose project)
│   ├── docker-compose.yml
│   ├── .env                   ← Supabase service secrets (POSTGRES_PASSWORD, JWT_SECRET, …)
│   └── volumes/               ← Postgres data, storage objects, logs (DO NOT delete)
│
└── backups/                   ← nightly pg_dump + storage tarballs
```

NGINX config lives under `/etc/nginx/sites-available/`. TLS certs are written to
`/etc/letsencrypt/live/<host>/`. Static frontend files are served from
`/srv/abc-glance/app/dist/` directly by NGINX.

Create the tree:

```bash
sudo mkdir -p /srv/abc-glance/{app,supabase,backups}
sudo chown -R $USER:$USER /srv/abc-glance
cd /srv/abc-glance
```

---

## 3. Self‑hosted Supabase

### 3.1 Bring up the stack

```bash
cd /srv/abc-glance/supabase
git clone --depth 1 https://github.com/supabase/supabase .supabase-src
cp -r .supabase-src/docker/* .
cp .env.example .env
```

### 3.2 Edit `/srv/abc-glance/supabase/.env`

Mandatory changes — **do not ship the defaults to production**:

```ini
############
# Postgres
############
POSTGRES_PASSWORD=<long-random-string>

############
# JWT
############
JWT_SECRET=<64+ chars random>            # generate: openssl rand -base64 64
ANON_KEY=<generate from Supabase tool>   # https://supabase.com/docs/guides/self-hosting/docker
SERVICE_ROLE_KEY=<generate>

############
# Public URLs (must match what NGINX exposes)
############
API_EXTERNAL_URL=https://api.example.com
SITE_URL=https://glance.example.com
SUPABASE_PUBLIC_URL=https://api.example.com
ADDITIONAL_REDIRECT_URLS=https://glance.example.com

############
# Studio (admin UI) — keep behind auth or LAN-only
############
STUDIO_DEFAULT_ORGANIZATION=ABC
STUDIO_DEFAULT_PROJECT=Glance
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<strong password>

############
# SMTP (used by Supabase Auth emails)
############
SMTP_ADMIN_EMAIL=ops@example.com
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<resend api key>
SMTP_SENDER_NAME=ABC Glance
```

Generate `ANON_KEY` and `SERVICE_ROLE_KEY` with the official helper:
<https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys> (paste your
`JWT_SECRET`, copy the two resulting JWTs).

### 3.3 Start it

```bash
cd /srv/abc-glance/supabase
docker compose pull
docker compose up -d
docker compose ps        # should show kong, db, auth, rest, storage, realtime, studio, functions
```

Postgres data lives in `./volumes/db/data`; storage objects in `./volumes/storage`.
**Back these up.** See §8.

### 3.4 Apply this project's migrations

```bash
cd /srv/abc-glance/app
supabase link --project-ref local        # answer prompts; pick "self-hosted"
# Or, simpler for self-hosting, push the SQL directly:
for f in supabase/migrations/*.sql; do
  PGPASSWORD=$POSTGRES_PASSWORD psql \
    -h 127.0.0.1 -p 5432 -U postgres -d postgres -f "$f"
done
```

---

## 4. Build & deploy the frontend

### 4.1 Clone & configure

```bash
cd /srv/abc-glance
git clone https://github.com/<your-fork>/abc-glance.git app
cd app
```

Create `/srv/abc-glance/app/.env.production`:

```ini
VITE_SUPABASE_URL=https://api.example.com
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from supabase .env>
VITE_SUPABASE_PROJECT_ID=local
```

> These three variables are **baked into the JS bundle at build time**. Rebuild after
> any change.

### 4.2 Build

```bash
bun install            # or: npm ci
bun run build          # outputs to ./dist
```

Result: `/srv/abc-glance/app/dist/` contains `index.html`, `assets/*.js`, `assets/*.css`,
plus the `public/` files. NGINX serves this folder.

### 4.3 Updating later

```bash
cd /srv/abc-glance/app
git pull
bun install
bun run build
sudo systemctl reload nginx     # not strictly required, but harmless
```

---

## 5. Edge Functions

The repo ships these functions under `supabase/functions/`:

```
admin-users              callout-request         camera-watch
arm-scheduler            callout-resolved        daily-report-send
escalate-offline         frigate-poll            frigate-proxy
super-callout-email      webhook-ingest          _shared/
```

Deploy them all to your self‑hosted Supabase:

```bash
cd /srv/abc-glance/app

# Tell the CLI where your stack lives
export SUPABASE_URL=https://api.example.com
export SUPABASE_ANON_KEY=<ANON_KEY>
export SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
export SUPABASE_ACCESS_TOKEN=<personal access token, if used>

# Deploy every function
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [ "$name" = "_shared" ] && continue
  supabase functions deploy "$name" --no-verify-jwt --project-ref local
done
```

### 5.1 Function secrets

Set these on the Supabase functions runtime (`docker compose exec functions ...` or
through Studio → Edge Functions → Secrets):

| Secret | Required? | What it does |
|--------|-----------|--------------|
| `SUPABASE_URL` | yes | Same as `API_EXTERNAL_URL` |
| `SUPABASE_ANON_KEY` | yes | For client‑style calls inside functions |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Admin operations (users, RLS bypass) |
| `RESEND_API_KEY` | recommended | Email (daily reports, callouts, alerts) |
| `EMERGENCY_USER` | optional | Override emergency login username (default `admin`) |
| `EMERGENCY_PASS` | optional | Override emergency password (default `Abcsec2008`) |
| `LOVABLE_API_KEY` | optional | Only if you keep using Lovable AI Gateway |

> **Change `EMERGENCY_PASS` in production.** The default exists only to bootstrap a brand
> new install.

---

## 6. NGINX

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

    client_max_body_size 25M;   # camera snapshot uploads
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
}
```

### 6.2 Supabase API site — `/etc/nginx/sites-available/api.conf`

```nginx
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # Supabase Kong listens on 8000 (HTTP) by default
    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Realtime / websockets
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 3600s;
    }

    client_max_body_size 50M;   # storage uploads (snapshots, branding)
}
```

### 6.3 Enable & issue TLS

```bash
sudo ln -s /etc/nginx/sites-available/glance.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.conf    /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d glance.example.com -d api.example.com \
     --redirect --agree-tos -m ops@example.com
```

Certbot's systemd timer auto‑renews. Verify with `sudo certbot renew --dry-run`.

---

## 7. First‑run admin bootstrap

The app is designed to bootstrap itself the first time you visit it on a clean database.

1. Open `https://glance.example.com/login`.
2. The login page calls `admin-users/seed?check_only=true`. On a fresh database it
   returns `needs_password: true` and the form switches to **"Create admin account"**.
3. Username is locked to `admin`. Enter a password (min 8 chars) and submit.
4. You're signed in and redirected to the dashboard. The "create admin" form will not
   re‑appear (the public endpoint refuses to overwrite an existing admin).

### 7.1 Recovery — if step 2 fails or you lose the password

Go to `https://glance.example.com/offline`. The page exposes two tools that talk
directly to the `admin-users` edge function using the emergency credentials:

- **Create / reset admin account** — uses `admin-users/emergency-reset` to rebuild the
  `admin` profile, role rows, and organization membership; then sets a new password.
- **Force create / repair admin account** — same endpoint, called with the default
  emergency credentials (`admin / Abcsec2008` unless you set `EMERGENCY_USER` /
  `EMERGENCY_PASS`). Use this when the seed check itself is broken.

After recovery, **rotate `EMERGENCY_PASS`** via Supabase function secrets and redeploy
the `admin-users` function:

```bash
supabase functions deploy admin-users --no-verify-jwt --project-ref local
```

---

## 8. Backups, upgrades, troubleshooting

### 8.1 Nightly backup (cron)

`/etc/cron.daily/abc-glance-backup`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%F)
OUT=/srv/abc-glance/backups
mkdir -p "$OUT"

# Postgres
docker compose -f /srv/abc-glance/supabase/docker-compose.yml exec -T db \
  pg_dump -U postgres postgres | gzip > "$OUT/db-$TS.sql.gz"

# Storage objects
tar czf "$OUT/storage-$TS.tar.gz" -C /srv/abc-glance/supabase/volumes storage

# Retain 14 days
find "$OUT" -type f -mtime +14 -delete
```

`chmod +x /etc/cron.daily/abc-glance-backup`.

### 8.2 Updating the app

```bash
cd /srv/abc-glance/app
git pull
bun install
bun run build
# Re-deploy any changed edge functions / migrations:
for f in supabase/migrations/*.sql; do
  PGPASSWORD=$POSTGRES_PASSWORD psql -h 127.0.0.1 -U postgres -d postgres -f "$f"
done
supabase functions deploy --project-ref local --no-verify-jwt
```

### 8.3 Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Login page never switches to "create admin" | Edge function `admin-users` not deployed | `supabase functions deploy admin-users` |
| 401 / "Invalid JWT" on every request | `ANON_KEY` in `.env.production` doesn't match Supabase `.env` | Rebuild frontend after fixing the key |
| Realtime never connects | NGINX missing `Upgrade`/`Connection` headers on `/api.example.com` | Use the config in §6.2 verbatim |
| Camera snapshots fail to upload | `client_max_body_size` too low | Raise it on both NGINX server blocks |
| Edge functions can't reach the NVR | Functions container has no LAN route | Use `network_mode: host` on the `functions` service, or put the NVR on the same Docker network |
| Daily report emails don't arrive | `RESEND_API_KEY` unset or SMTP block wrong | Set the secret, redeploy `daily-report-send` |

### 8.4 Useful one‑liners

```bash
# Tail edge function logs
docker compose -f /srv/abc-glance/supabase/docker-compose.yml logs -f functions

# Open a psql shell
docker compose -f /srv/abc-glance/supabase/docker-compose.yml exec db \
  psql -U postgres -d postgres

# Restart just the API gateway
docker compose -f /srv/abc-glance/supabase/docker-compose.yml restart kong
```

---

## Appendix A — Minimal checklist

- [ ] DNS A records for `glance.example.com` and `api.example.com`
- [ ] Docker + Compose + Node 20 + NGINX + Certbot installed
- [ ] `/srv/abc-glance/supabase/.env` filled in with strong secrets
- [ ] `docker compose up -d` shows all services healthy
- [ ] Migrations applied (`supabase/migrations/*.sql`)
- [ ] All edge functions deployed, function secrets set
- [ ] `/srv/abc-glance/app/.env.production` filled in
- [ ] `bun run build` produced `dist/`
- [ ] Both NGINX sites enabled, TLS issued
- [ ] First‑run admin created at `/login`
- [ ] `EMERGENCY_PASS` rotated, backups scheduled
