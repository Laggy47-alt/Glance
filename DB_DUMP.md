# 🗄️ Glance — Full Database Migration Guide (Dummy-Proof)

> **Goal:** Move EVERYTHING from your **current** self-hosted Supabase
> (`10.7.11.15`) to a **new** self-hosted Supabase (`192.168.9.1`) without
> losing a single row, user, NVR config, snapshot, or camera state.
>
> **Read this top-to-bottom. Don't skip steps. Each block is copy-paste ready.**

---

## 📋 What gets backed up

| What | Where it lives | Covered by which step |
|---|---|---|
| All app tables (`unifi_instances`, `webhook_events`, `profiles`, `user_roles`, `organizations`, `camera_status`, `camera_armed_state`, schedules, callouts, daily reports, etc.) | Postgres `public` schema | **Step 3** |
| Auth users (so people can still log in) | Postgres `auth` schema | **Step 4** |
| Storage files (camera snapshots, branding logos) | Disk: `/srv/supabase/volumes/storage/` | **Step 5** |
| Edge function code (unifi-poll, unifi-proxy, webhook-ingest, etc.) | Disk: `/srv/supabase/volumes/functions/` | **Step 6** |
| `.env` secrets (service role key, JWT secret, postgres password) | Disk: `/srv/supabase/.env` | **Step 7** |
| Cron jobs (pg_cron) | Postgres `cron` schema | **Step 8** |
| Realtime publication settings | Postgres | Included in Step 3 |

If you only do `pg_dump` of the `public` schema you **will lose users, snapshots, function code, and cron jobs**. Do every step.

---

## 🧭 Before you start

You need:

- [ ] SSH access to the **old** server (`10.7.11.15`) as a user that can `sudo` and read `/srv/supabase/.env`.
- [ ] SSH access to the **new** server (`192.168.9.1`) with Supabase already installed (containers up, `supabase-db` reachable on `5432`).
- [ ] The **postgres password** from **both** servers. Get it with:
  ```bash
  sudo grep POSTGRES_PASSWORD /srv/supabase/.env
  ```
- [ ] At least **5 GB free** in `/tmp` on the old server (more if you have lots of snapshots).
- [ ] Network: old server can reach new server on port `5432`. Test:
  ```bash
  nc -zv 192.168.9.1 5432
  ```
  Expected: `Connection to 192.168.9.1 5432 port [tcp/postgresql] succeeded!`

> ⚠️ **Stop the app on the OLD server before dumping** so nothing changes mid-backup:
> ```bash
> cd /srv/abc-glance/Glance
> sudo docker compose stop kong   # blocks API/UI; DB keeps running
> ```
> (Re-start with `sudo docker compose start kong` after the dump if you need the old server back online.)

---

## 🪜 Step-by-step

### Step 1 — SSH into the OLD server and set passwords

```bash
ssh glance@10.7.11.15

# Grab passwords once so the rest of the commands are copy-paste
export SRC_PASS="$(sudo grep POSTGRES_PASSWORD /srv/supabase/.env | cut -d= -f2)"
export DST_PASS='PASTE-NEW-SERVER-POSTGRES-PASSWORD-HERE'
export SRC_HOST=10.7.11.15
export DST_HOST=192.168.9.1

# Sanity check — should print the version of the source DB
PGPASSWORD="$SRC_PASS" psql -h $SRC_HOST -U postgres -d postgres -c "SELECT version();"

# And the destination DB
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres -c "SELECT version();"
```

If either psql fails → **STOP**. Fix connectivity / password before continuing.

---

### Step 2 — Create a backup folder

```bash
mkdir -p /tmp/glance-backup
cd /tmp/glance-backup
date > taken-at.txt
```

All artifacts go here so you can `rsync` or `scp` them anywhere later.

---

### Step 3 — Dump the `public` schema (all app data + structure)

```bash
PGPASSWORD="$SRC_PASS" pg_dump \
  -h $SRC_HOST -p 5432 -U postgres -d postgres \
  --schema=public \
  --no-owner --no-privileges \
  --clean --if-exists \
  -Fc -f /tmp/glance-backup/public.dump

ls -lh /tmp/glance-backup/public.dump
```

Expected: a file at least a few MB. If it's < 100 KB something's wrong.

**Quick sanity check** — list tables inside the dump:

```bash
pg_restore -l /tmp/glance-backup/public.dump | grep "TABLE DATA public" | head -40
```

You should see `unifi_instances`, `unifi_events`, `webhook_events`, `camera_status`, `profiles`, `user_roles`, `organizations`, etc.

---

### Step 4 — Dump the `auth` schema (users, so people can still log in)

> ⚠️ Auth schema **structure** belongs to Supabase and is already on the new
> server — we only copy the **data** (users, identities, sessions).

```bash
PGPASSWORD="$SRC_PASS" pg_dump \
  -h $SRC_HOST -p 5432 -U postgres -d postgres \
  --schema=auth \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  -Fc -f /tmp/glance-backup/auth.dump

ls -lh /tmp/glance-backup/auth.dump
```

---

### Step 5 — Copy storage files (snapshots, logos)

These are real files on disk, **not** in Postgres. Without this step, every
camera snapshot URL on the new server will return 404.

**Option A — old and new server can talk over SSH (recommended):**

```bash
# Run this ON THE OLD SERVER
sudo rsync -avh --progress \
  /srv/supabase/volumes/storage/ \
  glance@192.168.9.1:/tmp/glance-backup/storage/
```

**Option B — copy to a USB / network share first:**

```bash
sudo tar -czf /tmp/glance-backup/storage.tar.gz -C /srv/supabase/volumes storage
ls -lh /tmp/glance-backup/storage.tar.gz
```

---

### Step 6 — Copy edge function code

```bash
sudo tar -czf /tmp/glance-backup/functions.tar.gz \
  -C /srv/supabase/volumes functions
ls -lh /tmp/glance-backup/functions.tar.gz
```

---

### Step 7 — Copy `.env` (secrets — KEEP SAFE)

> 🔐 This file contains your service-role JWT, JWT secret, and postgres
> password. Treat it like a password. Don't email it. Don't commit it.

```bash
sudo cp /srv/supabase/.env /tmp/glance-backup/supabase.env
sudo chown $USER /tmp/glance-backup/supabase.env
chmod 600 /tmp/glance-backup/supabase.env
```

---

### Step 8 — Dump cron jobs (if you use pg_cron for the poll loop)

```bash
PGPASSWORD="$SRC_PASS" psql -h $SRC_HOST -U postgres -d postgres -At \
  -c "SELECT 'SELECT cron.schedule(' ||
            quote_literal(jobname) || ',' ||
            quote_literal(schedule) || ',' ||
            quote_literal(command) || ');'
      FROM cron.job;" \
  > /tmp/glance-backup/cron-jobs.sql

cat /tmp/glance-backup/cron-jobs.sql
```

If the file is empty, you have no cron jobs (the unifi poll is most likely on systemd — covered in step 12).

---

### Step 9 — Transfer the whole backup to the NEW server

If you didn't use rsync in step 5:

```bash
# On the OLD server
cd /tmp
tar -czf glance-backup.tgz glance-backup/
ls -lh glance-backup.tgz

# Copy it across
scp glance-backup.tgz glance@192.168.9.1:/tmp/

# On the NEW server
ssh glance@192.168.9.1
cd /tmp && tar -xzf glance-backup.tgz
ls /tmp/glance-backup/
```

You should see: `public.dump`, `auth.dump`, `storage/` (or `storage.tar.gz`), `functions.tar.gz`, `supabase.env`, `cron-jobs.sql`, `taken-at.txt`.

---

### Step 10 — Restore on the NEW server

Now you're on `192.168.9.1`. Re-export the password vars:

```bash
export DST_PASS="$(sudo grep POSTGRES_PASSWORD /srv/supabase/.env | cut -d= -f2)"
export DST_HOST=192.168.9.1
```

**10a. Restore `public` schema (app data):**

```bash
PGPASSWORD="$DST_PASS" pg_restore \
  -h $DST_HOST -p 5432 -U postgres -d postgres \
  --no-owner --no-privileges \
  --clean --if-exists \
  --disable-triggers \
  /tmp/glance-backup/public.dump
```

Some `NOTICE` / "does not exist, skipping" lines are normal on `--clean --if-exists`. **Real errors** look like `ERROR:` followed by a constraint or permission complaint — read those.

**10b. Restore `auth` data (users):**

```bash
PGPASSWORD="$DST_PASS" pg_restore \
  -h $DST_HOST -p 5432 -U postgres -d postgres \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  /tmp/glance-backup/auth.dump
```

**10c. Restore cron jobs (skip if step 8 was empty):**

```bash
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres \
  -f /tmp/glance-backup/cron-jobs.sql
```

---

### Step 11 — Restore storage files

```bash
# If you used rsync in step 5, files are already at /tmp/glance-backup/storage/
sudo rsync -avh /tmp/glance-backup/storage/ /srv/supabase/volumes/storage/

# Or if you used the tar option:
sudo tar -xzf /tmp/glance-backup/storage.tar.gz -C /srv/supabase/volumes/

# Fix permissions (Supabase storage container runs as UID 1000)
sudo chown -R 1000:1000 /srv/supabase/volumes/storage
```

---

### Step 12 — Restore edge functions + restart the functions container

```bash
sudo tar -xzf /tmp/glance-backup/functions.tar.gz -C /srv/supabase/volumes/

# Restart the functions container so it picks up the new code
cd /srv/supabase
sudo docker compose restart functions
```

If the unifi poll runs via systemd timer on the old server, copy those across too:

```bash
# On old server
sudo cat /etc/systemd/system/unifi-poll.service /etc/systemd/system/unifi-poll.timer /etc/unifi-poll.env

# Recreate on the new server with the same contents
sudo nano /etc/systemd/system/unifi-poll.service
sudo nano /etc/systemd/system/unifi-poll.timer
sudo nano /etc/unifi-poll.env     # update SERVICE_ROLE_KEY if it changed
sudo systemctl daemon-reload
sudo systemctl enable --now unifi-poll.timer
```

---

### Step 13 — Verify nothing is missing

Run these on the **new** server and compare counts to the **old** server.

**Row counts:**

```bash
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres <<'SQL'
SELECT 'organizations'      AS table, COUNT(*) FROM public.organizations
UNION ALL SELECT 'profiles',            COUNT(*) FROM public.profiles
UNION ALL SELECT 'user_roles',          COUNT(*) FROM public.user_roles
UNION ALL SELECT 'auth.users',          COUNT(*) FROM auth.users
UNION ALL SELECT 'unifi_instances',     COUNT(*) FROM public.unifi_instances
UNION ALL SELECT 'unifi_events',        COUNT(*) FROM public.unifi_events
UNION ALL SELECT 'webhook_sources',     COUNT(*) FROM public.webhook_sources
UNION ALL SELECT 'webhook_events',      COUNT(*) FROM public.webhook_events
UNION ALL SELECT 'frigate_instances',   COUNT(*) FROM public.frigate_instances
UNION ALL SELECT 'camera_status',       COUNT(*) FROM public.camera_status
UNION ALL SELECT 'camera_armed_state',  COUNT(*) FROM public.camera_armed_state
UNION ALL SELECT 'media_items',         COUNT(*) FROM public.media_items
UNION ALL SELECT 'callout_requests',    COUNT(*) FROM public.callout_requests
ORDER BY 1;
SQL
```

**NVRs and Frigates are present:**

```bash
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres \
  -c "SELECT name, base_url, enabled, poll_enabled FROM public.unifi_instances;"

PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres \
  -c "SELECT name, host, enabled FROM public.frigate_instances;"
```

**Users can authenticate:** open the new server's URL → log in with the same username/password as before. If login fails with "Invalid login credentials":
- Check that `auth.users` count matches.
- Make sure the **JWT secret** is the same (compare `JWT_SECRET=` in both `.env` files). If they differ, either:
  1. Copy `JWT_SECRET` from old `.env` to new `.env`, restart all containers, OR
  2. Have users reset passwords on the new server.

**Storage files served:** open any camera snapshot in the app — if it 404s, recheck step 11 (folder structure + permissions).

---

### Step 14 — Point DNS / clients at the new server

Once verified, update your reverse proxy / DNS so `supabase.abcglance.co.za`
points at `192.168.9.1`, **or** edit the frontend `.env` (`VITE_SUPABASE_URL`)
and redeploy.

If you change the API URL but keep the same JWT secret, existing browser
sessions keep working. If JWT secret changes, all sessions are invalidated and
users log in again.

---

## 🧯 Common errors & fixes

| Error during restore | Fix |
|---|---|
| `role "anon" does not exist` | The new server isn't a Supabase stack. Use a real Supabase install. |
| `permission denied for schema public` | You forgot `--no-owner --no-privileges`. Re-run with those flags. |
| `duplicate key value violates unique constraint` on auth.users | Auth users already exist on destination. Either wipe them first (`TRUNCATE auth.users CASCADE` — destructive!) or skip step 4. |
| Snapshots 404 after migration | Step 11 missed. Files must end up under `/srv/supabase/volumes/storage/stub/...` matching the old layout, owned by UID 1000. |
| Login says "Invalid credentials" but user exists | `JWT_SECRET` differs between old and new `.env`. Copy the old value over and restart all Supabase containers. |
| `pg_restore: connection to server ... failed` | Wrong host/password, or destination firewall blocks 5432. Test with `psql` first. |
| `relation "public.xxx" already exists` | Drop the table first or re-run pg_restore with `--clean --if-exists` (already in the command above). |

---

## 🧪 Dry-run option (optional, safer)

If you want to test the restore against a throwaway DB first:

```bash
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres \
  -c "CREATE DATABASE glance_test;"

PGPASSWORD="$DST_PASS" pg_restore -h $DST_HOST -U postgres -d glance_test \
  --no-owner --no-privileges /tmp/glance-backup/public.dump

# Inspect
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d glance_test \
  -c "SELECT COUNT(*) FROM public.unifi_instances;"

# Cleanup
PGPASSWORD="$DST_PASS" psql -h $DST_HOST -U postgres -d postgres \
  -c "DROP DATABASE glance_test;"
```

---

## ✅ Final checklist before decommissioning the old server

- [ ] Step 13 row counts match between old and new
- [ ] You can log in on the new server with an existing user
- [ ] An NVR poll trigger returns `scanned: N, alerts: N` (no error)
- [ ] A camera snapshot loads in the UI
- [ ] WhatsApp alerts / callouts still fire (test with one event)
- [ ] `/tmp/glance-backup.tgz` is archived somewhere safe (NAS, S3, USB)
- [ ] DNS / reverse proxy updated
- [ ] Old server kept running for **at least 7 days** as a fallback

Don't shut down `10.7.11.15` until you've used the new server for a full week
without issues. Storage is cheap; data loss isn't.
