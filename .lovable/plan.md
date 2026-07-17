## Goal

Let you `git pull` only the frontend or only the backend on your self-hosted server, without splitting the Lovable project into two repos.

## Why not two repos

Lovable syncs this project to a single GitHub repository. Splitting it into two would break the Lovable ↔ GitHub sync (Lovable would only track one of them, and the other would drift). The clean approach is to keep one repo and use **git sparse-checkout** on the server so each checkout only materializes the paths you care about.

## What counts as frontend vs backend

Frontend (what the Vite build/nginx serves):
```
src/            index.html      public/
vite.config.ts  tsconfig*.json  tailwind.config.ts
postcss.config.js  components.json  package.json  package-lock.json  bun.lock*
apps/responder-android/
```

Backend (what Supabase + scripts run):
```
supabase/                    self-hosted-migrations/
scripts/                     db/
```

Shared/docs (pull with either):
```
*.md   help/   docs/   .env.example
```

## Plan

1. Add a `.gitattributes`-free convention doc `help/REPO_LAYOUT.md` listing the frontend/backend path sets above, so both server clones use the same definitions.
2. On the server, keep **two working trees** of the same GitHub repo — one for the frontend deploy path, one for the backend deploy path — each with sparse-checkout enabled:

   ```bash
   # Frontend clone (e.g. /srv/abc-glance-frontend)
   git clone --filter=blob:none --no-checkout <repo-url> abc-glance-frontend
   cd abc-glance-frontend
   git sparse-checkout init --cone
   git sparse-checkout set src public apps/responder-android \
       index.html vite.config.ts tsconfig.app.json tsconfig.json tsconfig.node.json \
       tailwind.config.ts postcss.config.js components.json \
       package.json package-lock.json bun.lock
   git checkout main

   # Backend clone (e.g. /srv/abc-glance-backend)
   git clone --filter=blob:none --no-checkout <repo-url> abc-glance-backend
   cd abc-glance-backend
   git sparse-checkout init --cone
   git sparse-checkout set supabase self-hosted-migrations scripts db help
   git checkout main
   ```

   After that, `git pull` in each directory only updates the paths in its sparse set — frontend pulls skip backend changes on disk and vice-versa (though both are still fetched from the remote, git just doesn't check them out).

3. Add two thin deploy helper scripts to the repo so both server clones can run a one-liner:
   - `scripts/deploy-frontend.sh` — `git pull` + `npm ci` + `npm run build` + rsync `dist/` to nginx web root.
   - `scripts/deploy-backend.sh` — `git pull` + `supabase functions deploy` for changed functions + apply new `self-hosted-migrations/*.sql`.
4. Document the whole setup in `help/SPLIT_DEPLOY.md`: initial clone commands, how to change the sparse set later (`git sparse-checkout set …`), and when a change touches both (e.g. edge function + frontend that calls it) so you know to run both scripts.

## What this does NOT do

- It does not create two GitHub repositories.
- It does not remove backend files from the frontend clone's history — sparse-checkout only controls what's on disk, not what's in `.git`. If you need physical separation (e.g. giving someone read access to only the frontend), that requires a real repo split and would break Lovable sync.
- Lovable itself keeps seeing the full monorepo, unchanged.

## Files to add (build phase)

- `help/REPO_LAYOUT.md` — canonical list of frontend vs backend paths.
- `help/SPLIT_DEPLOY.md` — server setup + daily workflow.
- `scripts/deploy-frontend.sh`, `scripts/deploy-backend.sh` — deploy helpers.

No existing source files change.

## Open question

Do you want the two deploy helper scripts to also restart services (nginx reload for frontend, `docker compose restart functions` for backend), or just build/deploy and let you restart manually?
