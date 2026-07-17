# Repo Layout — Frontend vs Backend

This repo is a single Lovable-managed monorepo. On the server we use
`git sparse-checkout` to materialize only the frontend **or** only the
backend paths so `git pull` never touches the other side on disk.

## Frontend paths (Vite build → nginx)

```
src/
public/
apps/responder-android/
index.html
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
tailwind.config.ts
postcss.config.js
components.json
package.json
package-lock.json
bun.lock
```

## Backend paths (Supabase edge functions, migrations, host scripts)

```
supabase/
self-hosted-migrations/
scripts/
db/
```

## Shared (safe to include in either checkout)

```
help/
docs/
*.md          (top-level docs)
.env.example
```

## Rules

- Any new frontend file must live under one of the frontend paths above.
- Any new edge function goes under `supabase/functions/<name>/`.
- Any new migration goes under `self-hosted-migrations/` with an ISO-date prefix.
- If you add a **new top-level directory**, update this file **and** the
  sparse-checkout set on both server clones (see `SPLIT_DEPLOY.md`).
