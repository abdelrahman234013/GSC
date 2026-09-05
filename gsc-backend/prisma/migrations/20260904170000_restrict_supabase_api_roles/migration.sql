-- Closes the Supabase auto-generated REST API (PostgREST) against this database.
--
-- WHY THIS EXISTS
--
-- Supabase runs a REST API over every project automatically, reachable with the
-- project's "anon" key -- a key that is designed to be public and normally lives
-- in frontend JavaScript. In a typical Supabase app that is safe, because Row
-- Level Security policies decide which rows each caller may see.
--
-- This app does NOT work that way. The browser talks to our Express API, and
-- Express talks to Postgres as the "postgres" role. We never use the anon key,
-- never use PostgREST, and enforce authorisation in application code
-- (requireCustomerAuth / requireAdminAuth / resolveCustomerId).
--
-- But Prisma creates tables via raw SQL migrations, which do not enable RLS,
-- while Supabase's default privileges grant every new table to anon and
-- authenticated. Net result before this migration: anon held full
-- SELECT/INSERT/UPDATE/DELETE on every table, including "admins" (password
-- hashes) and "customers" (names, phones, addresses), with RLS on zero tables.
-- The only thing preventing access was that nobody had published the key yet --
-- secrecy, not access control.
--
-- SAFE FOR THE APP: our connection role is "postgres", which has BYPASSRLS and
-- keeps its own grants. Nothing below touches it. service_role is also left
-- alone, since its key is a server-side secret used by Supabase Storage.

-- 1) Remove the grants that exist on tables created so far.
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2) Stop the same grants being handed to tables created in FUTURE migrations.
--    Without this, the next `prisma migrate deploy` that adds a table would
--    silently reopen the hole, because Supabase's default privileges grant
--    everything in "public" to anon and authenticated automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated;

-- 3) Enable Row Level Security as a second, independent layer.
--    With RLS on and NO policies defined, Postgres denies all access to any role
--    that does not bypass RLS -- which is exactly what we want for anon and
--    authenticated. "postgres" has BYPASSRLS, so the application is unaffected.
--    This is deliberately redundant with step 1: if a future grant is ever
--    restored by accident, RLS still refuses the read.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname <> '_prisma_migrations'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;
