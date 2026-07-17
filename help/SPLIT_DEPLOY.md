# Split Frontend/Backend Deploy

Keep a single GitHub repo (Lovable-managed) but check out **only** the
frontend or **only** the backend on the server using git sparse-checkout.
That way `git pull` in each working tree updates just that side.

See `REPO_LAYOUT.md` for the canonical path list.

---

## One-time server setup

Replace `<repo-url>` with your GitHub repo URL (SSH or HTTPS).

### 1. Frontend clone

```bash
cd /srv
git clone --filter=blob:none --no-checkout <repo-url> abc-glance-frontend
cd abc-glance-frontend
git sparse-checkout init --cone
git sparse-checkout set \
  src public apps \
  help docs \
  index.html vite.config.ts \
  tsconfig.json tsconfig.app.json tsconfig.node.json \
  tailwind.config.ts postcss.config.js components.json \
  package.json package-lock.json bun.lock
git checkout main
```

### 2. Backend clone

```bash
cd /srv
git clone --filter=blob:none --no-checkout <repo-url> abc-glance-backend
cd abc-glance-backend
git sparse-checkout init --cone
git sparse-checkout set \
  supabase self-hosted-migrations scripts db \
  help docs
git checkout main
```

> `--cone` mode restricts sparse-checkout to directory-level patterns
> (fast + safe). Top-level files listed above are always included.

---

## Daily workflow

### Pull + deploy frontend only

```bash
cd /srv/abc-glance-frontend
./scripts/deploy-frontend.sh
```

(If `scripts/` isn't in the sparse set, run the same commands manually —
see the script for the exact sequence.)

### Pull + deploy backend only

```bash
cd /srv/abc-glance-backend
./scripts/deploy-backend.sh
```

---

## Changing the sparse set later

If you add a new top-level directory (e.g. `mobile/`), update the sparse
set on the relevant clone(s):

```bash
cd /srv/abc-glance-frontend
git sparse-checkout set <existing paths...> mobile
```

Then update `REPO_LAYOUT.md` in the repo so it stays canonical.

---

## When a change touches both sides

Example: you add a new edge function **and** a frontend page that calls it.

```bash
# backend first (function must exist before frontend calls it)
cd /srv/abc-glance-backend && ./scripts/deploy-backend.sh
# then frontend
cd /srv/abc-glance-frontend && ./scripts/deploy-frontend.sh
```

---

## What this does NOT do

- It does **not** split the repo into two GitHub repos — Lovable still
  syncs the full monorepo.
- Sparse-checkout only controls what's on disk. The `.git` folder still
  contains full history for both sides. If you need physical separation
  for access control, that's a different (and Lovable-breaking) change.
