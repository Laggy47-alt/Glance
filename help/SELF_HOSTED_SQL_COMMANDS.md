# Self-Hosted Supabase — SQL / Docker Command Cheatsheet

All commands assume you are in the directory that contains your Supabase `docker-compose.yml` (the one that ships with the self-hosted stack). The database container is named `db` in the default compose file.

If your container has a different name, replace `db` accordingly, or find it with:

```bash
docker compose ps
```

## Command shape

Two equivalent shapes are used throughout:

```bash
# One-shot query
docker compose exec -T db psql -U postgres -d postgres -c "SELECT 1;"

# Interactive psql shell
docker compose exec -it db psql -U postgres -d postgres
```

Inside the interactive shell:

```
\dt public.*         -- list tables
\d public.profiles   -- describe a table
\du                  -- list roles
\q                   -- quit
```

Tip: pipe long output through `less`:

```bash
docker compose exec -T db psql -U postgres -d postgres -c "..." | less -S
```

---

## 1. Organizations

### List every organization with member count

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT o.id, o.slug, o.name,
       (SELECT count(*) FROM public.organization_members m WHERE m.organization_id = o.id) AS members
FROM public.organizations o
ORDER BY o.slug;"
```

### List members of a specific org (replace `abc-2026`)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.email, p.username, p.display_name, om.role, u.last_sign_in_at
FROM public.organization_members om
JOIN public.organizations o ON o.id = om.organization_id
JOIN auth.users u          ON u.id = om.user_id
LEFT JOIN public.profiles p ON p.user_id = om.user_id
WHERE o.slug = 'abc-2026'
ORDER BY om.role, u.email;"
```

### Users that belong to more than one org

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.email, count(*) AS orgs, array_agg(o.slug ORDER BY o.slug) AS org_slugs
FROM public.organization_members om
JOIN public.organizations o ON o.id = om.organization_id
JOIN auth.users u          ON u.id = om.user_id
GROUP BY u.email
HAVING count(*) > 1
ORDER BY orgs DESC;"
```

### Users with no org

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.organization_members om ON om.user_id = u.id
WHERE om.user_id IS NULL
ORDER BY u.created_at DESC;"
```

---

## 2. Users & auth

### Total user count

```bash
docker compose exec -T db psql -U postgres -d postgres -c "SELECT count(*) FROM auth.users;"
```

### All users (basic listing)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT id, email, created_at, last_sign_in_at, email_confirmed_at IS NOT NULL AS confirmed
FROM auth.users
ORDER BY created_at DESC;"
```

### Currently "logged in" — users with a valid (non-expired) refresh token

Supabase does not track sessions in a `sessions` table you can query the way a classic app would. The closest proxy is an unrevoked, unexpired refresh token.

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.email, s.updated_at AS last_token_activity
FROM auth.refresh_tokens rt
JOIN auth.sessions s ON s.id = rt.session_id
JOIN auth.users u    ON u.id = s.user_id
WHERE rt.revoked = false
ORDER BY s.updated_at DESC;"
```

### Active sessions in the last 24h (by last sign-in)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT email, last_sign_in_at
FROM auth.users
WHERE last_sign_in_at > now() - interval '24 hours'
ORDER BY last_sign_in_at DESC;"
```

### New sign-ups in the last 7 days

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT email, created_at
FROM auth.users
WHERE created_at > now() - interval '7 days'
ORDER BY created_at DESC;"
```

### Users who never signed in

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT email, created_at
FROM auth.users
WHERE last_sign_in_at IS NULL
ORDER BY created_at DESC;"
```

### Unconfirmed email accounts

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT email, created_at
FROM auth.users
WHERE email_confirmed_at IS NULL
ORDER BY created_at DESC;"
```

### Force-confirm an email (rescue account)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
UPDATE auth.users
SET email_confirmed_at = now(), confirmed_at = now()
WHERE email = 'user@example.com';"
```

### Reset a user's password (bcrypt via pgcrypto)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
UPDATE auth.users
SET encrypted_password = crypt('NewStrongPassword!', gen_salt('bf'))
WHERE email = 'user@example.com';"
```

### Force logout: revoke all refresh tokens for a user

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
UPDATE auth.refresh_tokens SET revoked = true
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'user@example.com');"
```

### Delete a user completely

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
DELETE FROM auth.users WHERE email = 'user@example.com';"
```

---

## 3. Roles & admins

### List all role assignments

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.email, ur.role
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
ORDER BY ur.role, u.email;"
```

### All super admins

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.email
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE ur.role = 'super_admin';"
```

### Grant super_admin to a user

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin' FROM auth.users WHERE email = 'user@example.com'
ON CONFLICT DO NOTHING;"
```

### Revoke a role

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
DELETE FROM public.user_roles
WHERE role = 'super_admin'
  AND user_id = (SELECT id FROM auth.users WHERE email = 'user@example.com');"
```

---

## 4. Cameras / NVRs / Frigate

### Frigate instances per org

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT o.slug, count(*) AS instances
FROM public.frigate_instances f
JOIN public.organizations o ON o.id = f.organization_id
GROUP BY o.slug
ORDER BY instances DESC;"
```

### Hikvision NVRs

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT h.name, o.slug AS org, h.host, h.enabled, h.last_seen_at
FROM public.hikvision_instances h
JOIN public.organizations o ON o.id = h.organization_id
ORDER BY o.slug, h.name;"
```

### UniFi instances

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.name, o.slug AS org, u.enabled, u.last_seen_at
FROM public.unifi_instances u
JOIN public.organizations o ON o.id = u.organization_id
ORDER BY o.slug, u.name;"
```

### Camera status snapshot

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT camera_name, is_online, last_seen_at, updated_at
FROM public.camera_status
ORDER BY is_online, last_seen_at DESC NULLS LAST
LIMIT 100;"
```

### Currently offline cameras

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT camera_name, last_seen_at
FROM public.camera_status
WHERE is_online = false
ORDER BY last_seen_at DESC NULLS LAST;"
```

### Currently armed cameras

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT camera_name, is_armed, updated_at
FROM public.camera_armed_state
WHERE is_armed = true
ORDER BY updated_at DESC;"
```

---

## 5. Events / alerts

### Webhook events in the last hour

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT id, source_id, event_type, created_at
FROM public.webhook_events
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC;"
```

### UniFi events today (Africa/Johannesburg)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT camera_name, event_type, created_at AT TIME ZONE 'Africa/Johannesburg' AS local_time
FROM public.unifi_events
WHERE created_at >= (now() AT TIME ZONE 'Africa/Johannesburg')::date
ORDER BY created_at DESC;"
```

### Hikvision events today

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT channel_id, event_type, created_at AT TIME ZONE 'Africa/Johannesburg' AS local_time
FROM public.hikvision_events
WHERE created_at >= (now() AT TIME ZONE 'Africa/Johannesburg')::date
ORDER BY created_at DESC;"
```

### Event counts by source over 24h

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT 'unifi'    AS src, count(*) FROM public.unifi_events    WHERE created_at > now() - interval '24 hours'
UNION ALL
SELECT 'hikvision', count(*) FROM public.hikvision_events WHERE created_at > now() - interval '24 hours'
UNION ALL
SELECT 'webhook',   count(*) FROM public.webhook_events   WHERE created_at > now() - interval '24 hours';"
```

---

## 6. WhatsApp / callouts

### Recent outbound settings

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT organization_id, mudslide_base_url, enabled, updated_at
FROM public.whatsapp_settings
ORDER BY updated_at DESC;"
```

### Incoming WA messages (last 50)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT from_number, body, received_at
FROM public.whatsapp_incoming_messages
ORDER BY received_at DESC
LIMIT 50;"
```

### Callout requests today

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT id, camera_name, status, created_at
FROM public.callout_requests
WHERE created_at >= (now() AT TIME ZONE 'Africa/Johannesburg')::date
ORDER BY created_at DESC;"
```

---

## 7. Database housekeeping

### Show DB size

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT pg_size_pretty(pg_database_size('postgres')) AS size;"
```

### Top 20 largest tables

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT schemaname||'.'||relname AS table,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;"
```

### Active DB connections

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT pid, usename, application_name, state, query_start, left(query,80) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start;"
```

### Long-running queries (>30s)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT pid, now()-query_start AS runtime, usename, left(query,120) AS query
FROM pg_stat_activity
WHERE state = 'active' AND now()-query_start > interval '30 seconds'
ORDER BY runtime DESC;"
```

### Kill a query by PID

```bash
docker compose exec -T db psql -U postgres -d postgres -c "SELECT pg_terminate_backend(12345);"
```

### List all tables in public

```bash
docker compose exec -T db psql -U postgres -d postgres -c "\dt public.*"
```

### Describe a specific table

```bash
docker compose exec -T db psql -U postgres -d postgres -c "\d public.profiles"
```

### Show all RLS policies

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;"
```

### Reindex a table

```bash
docker compose exec -T db psql -U postgres -d postgres -c "REINDEX TABLE public.webhook_events;"
```

### Vacuum + analyze the whole DB

```bash
docker compose exec -T db psql -U postgres -d postgres -c "VACUUM (ANALYZE);"
```

---

## 8. Backups & restore

### Dump the whole DB to a file on the host

```bash
docker compose exec -T db pg_dump -U postgres -d postgres -F c -f /tmp/backup.dump
docker compose cp db:/tmp/backup.dump ./backup_$(date +%F).dump
```

### Dump only the `public` schema as plain SQL

```bash
docker compose exec -T db pg_dump -U postgres -d postgres -n public -F p > ./public_$(date +%F).sql
```

### Dump a single table to CSV

```bash
docker compose exec -T db psql -U postgres -d postgres -c \
  "COPY (SELECT * FROM public.webhook_events) TO STDOUT WITH CSV HEADER" \
  > ./webhook_events.csv
```

### Restore a custom-format dump

```bash
docker compose cp ./backup.dump db:/tmp/backup.dump
docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists /tmp/backup.dump
```

### Apply a migration file

```bash
docker compose cp ./supabase/migrations/20260702_something.sql db:/tmp/mig.sql
docker compose exec -T db psql -U postgres -d postgres -f /tmp/mig.sql
```

---

## 9. Storage buckets

### List buckets

```bash
docker compose exec -T db psql -U postgres -d postgres -c \
  "SELECT id, name, public FROM storage.buckets ORDER BY name;"
```

### Object count + total size per bucket

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT bucket_id,
       count(*) AS objects,
       pg_size_pretty(sum((metadata->>'size')::bigint)) AS total_size
FROM storage.objects
GROUP BY bucket_id
ORDER BY total_size DESC;"
```

### Recently uploaded objects (last 24h)

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT bucket_id, name, created_at
FROM storage.objects
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 50;"
```

---

## 10. Docker-level helpers (not SQL, but useful)

```bash
docker compose ps                       # container status
docker compose logs -f db               # tail DB logs
docker compose logs -f functions        # tail edge functions logs
docker compose restart functions        # restart edge functions
docker compose restart db               # restart DB (careful!)
docker stats                            # live CPU/memory
docker compose exec db bash             # shell into DB container
```

### Quick health check

```bash
docker compose exec -T db pg_isready -U postgres
```

---

## Notes

- All examples use `-T` to disable TTY allocation so they work inside scripts and non-interactive shells. Drop `-T` and add `-it` when you want an interactive prompt.
- Replace `postgres` with a different DB name if you have changed the default.
- Anything under the `auth`, `storage`, `realtime`, `supabase_functions`, and `vault` schemas is managed by Supabase — read freely, but only write to them when you know exactly what you're doing (the password reset / force-confirm snippets above are safe patterns).
