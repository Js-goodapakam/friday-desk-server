-- Forward-only migration for the existing custom-auth application profile.
-- Inspect and approve the target database before applying. No Auth identities created.
BEGIN;
-- Fail closed rather than expose the new preference through pre-existing broad grants.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='user'
   AND grantee IN ('anon','authenticated')
   AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
 ) THEN
  RAISE EXCEPTION 'Review public.user Data API grants and RLS before adding preferences. Production permissions are not changed by this migration.';
 END IF;
END $$;
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS preferred_language text DEFAULT 'en';
UPDATE public."user" SET preferred_language='en' WHERE preferred_language IS NULL;
ALTER TABLE public."user" ALTER COLUMN preferred_language SET DEFAULT 'en';
ALTER TABLE public."user" ALTER COLUMN preferred_language SET NOT NULL;
ALTER TABLE public."user" ADD CONSTRAINT friday_user_preferred_language_check
 CHECK (preferred_language IN ('en','kn'));
COMMENT ON COLUMN public."user".preferred_language IS
 'Individual application language; written by the session-authenticated Friday API.';
COMMIT;
-- RLS intentionally unchanged: this application uses integer IDs and custom sessions,
-- not auth.uid(). Never add an auth.uid()=id policy to this integer profile table.
-- The browser has no direct database credentials. API writes bind req.user.id only.
-- Review existing grants/RLS on the APPROVED target before production migration.
