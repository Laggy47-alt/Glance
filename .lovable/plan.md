
# Phase 1 — Real multi-tenancy

Restore real org scoping. Existing data and users are preserved — every current row backfills to the existing org (`c093c027-920c-4e88-865a-fb17413b3b5a`) and every current user gets an `organization_members` row in that same org.

UniFi is **not** part of this phase. We do it after multi-tenancy is verified.

## Step 1 — Migration (single transaction, runs on self-hosted ref `ragpwpshriqnieniaapx`)

Order matters; the whole thing wraps in `BEGIN…COMMIT`.

1. **Backfill `organization_members`** for every existing user based on their role in `user_roles` (super_admin/admin → role `admin`, customer → role `customer`) into the existing org. Idempotent (`on conflict do nothing`).
2. **Rewrite helper functions** (security definer):
   - `current_user_org()` → caller's primary org from `organization_members` (admin preferred), null if none.
   - `is_org_member(_uid, _org)` → real membership check, plus `true` if `is_super_admin(_uid)`.
   - `is_org_admin(_uid, _org)` → membership with role `admin`, plus `true` if super_admin.
   - `can_read_org(_org)` / `can_admin_org(_org)` → wrap the above against `auth.uid()`.
   - `user_has_instance` / `user_has_camera` → real checks against `customer_nvr_assignments` / `customer_camera_assignments` scoped to the same org.
3. **Add `organization_id`** (nullable first) to every table missing it or where it's nullable: `frigate_instances`, `webhook_sources`, `media_items`, `webhook_events`, `whatsapp_settings`, `daily_report_settings`, `daily_report_configs`, `daily_report_runs`, `callout_settings`, `callout_requests`, `camera_status`, `camera_armed_state`, `camera_arm_schedules`, `camera_arm_schedule_runs`, `camera_arm_audit`, `camera_offline_alerts`, `customer_camera_assignments`, `customer_nvr_assignments`, `customer_offline_instructions`, `offline_instruction_acks`, `auto_read_rules`, `media_tags`, `super_callout_requests`, `whatsapp_incoming_messages`.
4. **Backfill** every row's `organization_id` to the existing org id.
5. **Set `NOT NULL` + FK → organizations(id)** on each column.
6. **Update `fill_organization_id` trigger** to also fall back to `current_user_org()` and (for service-role inserts) leave already-set values alone. Re-attach the trigger to every newly-added column's table.
7. **Rewrite RLS policies** on each of the tables above:
   - Read: `can_read_org(organization_id)`
   - Write: `can_admin_org(organization_id)` (admin tables) or role-appropriate predicate (e.g. customer assignments stay admin-only writes, customer reads via assignment).
   - Customer-scoped reads (e.g. `CustomerEvents`, `Customer`) continue to use the existing assignment-table joins, but those tables are now org-scoped too.
   - `platform_settings` stays super-admin only and global.
8. **Linter pass** afterwards via `supabase--linter` to catch anything missed.

## Step 2 — Auth + shell

- `useAuth.tsx`: remove `SHARED_ORG` constant. Load real `orgs` from `organization_members` joined with `organizations`. Persist `activeOrgId` in localStorage. `activeOrg` is the selected one (default: first admin org, else first membership). Super-admin sees all orgs and can switch freely (`impersonateOrg`).
- `AuthGate`: if a signed-in user has zero memberships and isn't super_admin → render a small "No organization assigned, contact admin" screen.
- Sidebar: add an org switcher (only visible when `orgs.length > 1` or super-admin).

## Step 3 — Pages (verification pass)

The ~20 pages already read `activeOrg.id`. Most "just work" once `activeOrg` is real. We still touch each one to:

- Confirm every list query filters by `organization_id` (RLS will enforce, but explicit filters cut payload).
- Confirm every insert form sets `organization_id: activeOrg.id` (trigger covers it; explicit is safer).
- Pages to audit: `Sources`, `Frigate`, `CameraStatus`, `NvrStatus`, `Media`, `Callouts`, `DailyReports`, `WhatsAppAlerts`, `AutoRead`, `Offline`, `Wall`, `Overview`, `Users`, `Customer`, `CustomerEvents`, `CustomerInstructions`, `Customization`, `SuperAdmin`.

## Step 4 — Edge functions (per-org loops)

Functions that currently scan "all rows" need a per-org loop or an `organization_id` filter on each query. Outbound payloads (WhatsApp, emails) include the org id so downstream rows are tagged correctly.

- `camera-watch`, `frigate-poll`, `arm-scheduler` — loop per enabled instance, instance already carries org id.
- `daily-report-send`, `daily-offline-broadcast` — loop per org's settings row.
- `escalate-offline`, `escalate-offline-whatsapp`, `callout-request`, `callout-resolved`, `super-callout-email` — accept/derive org id, scope all reads + writes by it.
- `whatsapp-incoming` — resolve the inbound message's org by recipient phone → `whatsapp_settings.organization_id`.
- `admin-users` — restrict to admin's own org unless caller is super-admin.
- `webhook-ingest`, `frigate-proxy` — already keyed by source/instance id; just propagate `organization_id` onto inserted rows.

## Step 5 — Users page

- Org admin: invite/remove users in their org only (writes to `organization_members`).
- Super-admin: pick any org, do the same; can also assign super_admin role.
- `user_roles` stays global; `organization_members` carries the per-org role.

## Step 6 — Verification

- Seed a second org "Org B" via SuperAdmin, add one user and one Frigate instance to it.
- As Org A user: confirm Org B's instance/events/media/recipients are invisible on every page.
- As Org B user: same in reverse.
- As super-admin: switch between A and B via the switcher.
- Self-hosted guide update: short "Creating additional organizations" section in `SELF_HOSTED_DOCKER_GUIDE.md`.

## Safety

- Single-transaction migration: fully applies or fully rolls back.
- Forward + rollback migration written together (rollback reverts helper functions to stubs, drops added `organization_id` columns, restores prior RLS). Stored in `supabase/migrations/`.
- User runs `pg_dump` on `ragpwpshriqnieniaapx` before applying (recommended, not required).

## Out of scope for this phase

- UniFi Protect (Phase 2).
- Per-org branding, billing, or Mudslide instance.
- Migrating any existing row away from the current org.

## Technical notes

```text
migration (1 file, 1 tx)
   ├─ backfill organization_members from user_roles
   ├─ rewrite 6 helper functions
   ├─ add organization_id to ~24 tables (nullable → backfill → NOT NULL + FK)
   ├─ update fill_organization_id trigger + attach to new columns
   ├─ rewrite RLS policies on those ~24 tables
   └─ linter pass

app code
   ├─ useAuth: real orgs, activeOrg, switcher
   ├─ AuthGate: zero-org guard
   ├─ Sidebar: org switcher
   ├─ ~18 pages: verify org scoping on queries + inserts
   └─ ~11 edge functions: per-org loops / explicit org filters

verification
   ├─ 2-org manual cross-leak test
   ├─ supabase linter
   └─ self-host docs update
```

Existing data and users are preserved. After this phase ships and you've verified isolation works, we move on to UniFi.
