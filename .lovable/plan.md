# Strip multi-tenancy → single-tenant ABC

ABC org `c093c027-920c-4e88-865a-fb17413b3b5a` becomes the implicit, hard-coded tenant. The `test` org and all its data are deleted. All paywall/billing UI and logic are removed. Super admin role survives for user/branding management.

## Database migration (single SQL migration)

1. **Delete `test` org cascade** — remove rows in every tenant table where `organization_id = c181e17d-...`, then delete its memberships and the org row itself.
2. **Drop billing / payments tables**: `org_subscriptions`, `billing_acknowledgments`, `redemption_codes`, `redemption_code_uses`. Drop enum `org_sub_status`.
3. **Drop billing helper functions**: `org_is_active`, `org_trial_can_add_nvr`, `org_trial_can_send_email`, `increment_trial_email_count`, `redeem_code`, `signup_create_trial_org`.
4. **Simplify RLS** on every tenant table (`app_settings`, `webhook_sources`, `webhook_events`, `frigate_instances`, `media_items`, `media_tags`, `camera_*`, `auto_read_rules`, `daily_report_*`, `callout_*`, `customer_*`, `event_audit_log`, `offline_instruction_acks`, `super_callout_requests`):
   - Replace `can_read_org(...)` policies with `auth.uid() IS NOT NULL`.
   - Replace `can_admin_org(...)` write policies with `is_admin(auth.uid())` (uses existing `has_role`).
   - Customer-scoped policies (`user_has_instance`, `user_id = auth.uid()`) stay.
5. **Default `organization_id`** on every tenant table to ABC's UUID (so existing client inserts that omit it still work). `current_user_org()` is rewritten to just `select 'c093c027-...'::uuid`.
6. **Lock orgs**: keep `organizations` and `organization_members` (auth/profile code reads them), but RLS becomes read-only for everyone authenticated; only super admin can write. No new orgs can be created.

## Edge functions

- **Delete**: `payments-webhook`, `get-paddle-price`, `signup-trial`.
- Leave the rest untouched.

## Frontend

- **Delete pages**: `Billing.tsx`, `Pricing.tsx`, `Signup.tsx`. Remove their routes from `App.tsx`. `/signup` → redirect to `/login`.
- **Delete components**: `OrgGate.tsx`, `PaymentTestModeBanner.tsx`, `SubscriptionAdminPanel.tsx` (org-sub specific bits) — replace SubscriptionAdminPanel with a stub or remove from SuperAdmin.
- **Delete libs**: `src/lib/paddle.ts`, `src/hooks/useOrgSubscription.tsx`.
- **`useAuth`**: keep the org concept internally because RLS still uses `organization_id` defaults, but:
  - Always force `activeOrg` = ABC (fetch once, ignore membership list switching).
  - Remove org switcher UI from `AppSidebar` / `DashboardLayout`.
  - Super admin still can impersonate (no-op now, since only one org).
- **Remove `<OrgGate>` wrapper** from `App.tsx`. Remove suspended/billing redirects from `AuthGate`.
- **Login page**: remove "Sign up" link.
- **SuperAdmin page**: drop the subscriptions/billing tab; keep users, branding, codes (delete the codes section since redemption_codes is gone).

## Login auto-binding

Add a tiny one-shot effect in `useAuth` (or a new edge function `ensure-abc-membership`) that, after sign-in, inserts the user into `organization_members` for ABC if missing, role `customer`. This keeps RLS reads working without a signup flow.

## Out of scope / kept

- `organization_id` columns stay on every table (cheaper than rewriting every query).
- Super admin role + `/super` portal stay.
- Paddle secrets in Supabase remain (not actively used; harmless).

## Risk callouts

- This **cannot be undone** without restoring from a Supabase backup. Confirm before I run the migration.
- Any user currently a member of `test` org loses that membership. They keep their auth account; they'll get auto-added to ABC on next login.
- Hardcoding ABC's UUID into `current_user_org()` means cloning this codebase to a new project requires updating that function.
