## Goal
Gate the "Add Unifi ENVR" capability behind a per-organization feature flag that super admins control from `/super`.

## Database
New migration `docs/migrations/003_org_features.sql` (also applied via Lovable Cloud migration tool):

- `public.org_features` table
  - `organization_id uuid` references `organizations(id) on delete cascade`
  - `feature_key text` (e.g. `unifi_envr`)
  - `enabled boolean default true`
  - `created_at`, `updated_at`
  - Unique `(organization_id, feature_key)`
- GRANTs: `SELECT` to `authenticated`, `ALL` to `service_role`
- RLS:
  - SELECT: members of the org (`is_org_member`) OR `is_super_admin(auth.uid())`
  - INSERT/UPDATE/DELETE: `is_super_admin(auth.uid())` only
- Helper SQL function `public.org_has_feature(_org_id uuid, _key text) returns boolean` (security definer) for clean checks from the client and from RLS on future tables.

## Super Admin UI (`src/pages/SuperAdmin.tsx`)
- Add a new tab **Features** (next to Customization).
- Table of orgs × feature toggles. For now a single column: **Unifi ENVR**.
- Switch per row writes an upsert/delete to `org_features` (key = `unifi_envr`).
- Live-refresh via existing realtime channel.

## Client feature-flag plumbing
New tiny hook `src/hooks/useOrgFeatures.tsx`:
- Reads rows from `org_features` for the active org id (uses existing `activeOrgId` logic in `useAuth`).
- Exposes `hasFeature(key: string): boolean`.
- Subscribes to realtime changes on `org_features`.

## Conditional "Add Unifi ENVR" UI
Show the add UI only when `hasFeature('unifi_envr')` is true:

1. **Sources page** (`src/pages/Sources.tsx`) — add an "Add Unifi ENVR" button/section alongside existing Frigate site management. Reuse the existing `unifi_instances` schema. On submit, insert a row stamped with `organization_id = activeOrgId`.
2. **NVR Status page** (`src/pages/NvrStatus.tsx`) — add the same "Add Unifi ENVR" affordance and surface configured Unifi NVRs in the status list. If feature is off, hide entirely.

Both pages: when feature flag is false, render no Unifi UI at all (no empty state, no button).

## Backend writes
No new edge function needed — inserts go directly to `unifi_instances` under existing org-scoped RLS. Confirm `unifi_instances` already has an `organization_id` column and RLS scoped via `is_org_member`; if not, add column + policy in the same migration.

## Out of scope
- No changes to Unifi polling/ingest logic.
- No new feature keys beyond `unifi_envr` (table is built to grow later).
- Self-hosted DB sync: user runs the new `003_org_features.sql` against the self-hosted Supabase the same way as 001/002.

## Technical notes
- Keep tab order: Sites, Organizations, Callouts, Features, Customization.
- Use shadcn `Switch` for toggles.
- All `org_features` reads short-circuit to `false` when there is no active org id (e.g. impersonation cleared).
