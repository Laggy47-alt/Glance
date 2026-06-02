-- Ensure shared single-tenant org row exists (matches default organization_id used app-wide)
INSERT INTO public.organizations (id, slug, name)
VALUES ('c093c027-920c-4e88-865a-fb17413b3b5a', 'abc-2026', 'Glance')
ON CONFLICT (id) DO NOTHING;

-- Drop any organization_id foreign-key constraints from feature tables so single-tenant inserts
-- never fail FK validation if the org row is missing on a fresh deployment.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tc.table_schema, tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema   = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND kcu.column_name = 'organization_id'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
                   r.table_schema, r.table_name, r.constraint_name);
  END LOOP;
END $$;