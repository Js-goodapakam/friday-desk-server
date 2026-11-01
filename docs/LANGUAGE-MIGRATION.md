# User language preferences: audit and deployment gate

Status: feature implementation only; not production-ready. No production schema, grants, records or RLS policies were changed.

## Actual architecture

Client: React 19 / Vite SPA. API: Express 5 / node-postgres. Existing database connection: server-only DATABASE_URL pointing to Supabase Postgres via its pooler. Local development: isolated SQLite. Authentication: custom HttpOnly friday_session cookie, scrypt password hashes, friday_sessions and friday_credentials. Supabase Auth is not the application's identity provider. Profile IDs are integers in public."user"; do not create another profile table or compare them to auth.uid() UUIDs.

Users have propertyId and a role; explicit memberships live in friday_property_access. Existing Prisma contract snapshots are present but do not establish Supabase CLI migration history. The read-only target audit found public.user, but not the custom session/credential/membership tables expected by this API. The configured production connection must be reconciled with the deployed backend's target before release. No secret values were printed or copied to these worktrees.

## Security findings from read-only production inspection

- public.user has RLS disabled and no policies.
- anon and authenticated have SELECT, INSERT, UPDATE, DELETE and TRUNCATE grants (plus REFERENCES/TRIGGER).
- Data API exposure settings were not verified. If this schema is exposed, grants can bypass API authorisation.
- No grants or policies were modified. Production permission changes require explicit reviewed approval.
- The draft migration refuses to apply while broad browser-role write grants remain. It does not silently weaken RLS or grant new access.

## Proposed schema/API

supabase/migrations/20261101090000_user_preferred_language.sql adds only public.user.preferred_language, default en, NOT NULL, CHECK in (en,kn), preserving existing records. An existing primary-key index on id suffices for these single-user operations; no redundant language index is added. No trigger or new identity table is needed. Existing Prisma applied snapshots remain unchanged.

GET/PUT /api/me/preferences use the existing authentication and origin middleware. PUT accepts only preferred_language, rejects caller-provided identity fields, and binds the authenticated req.user.id. Session/login responses carry the saved language, with English fallback for rows from an unmigrated schema. Preference writes fail visibly if the migration is missing. Existing role access is not broadened.

## Staging-first process (not executed)

1. Identify the real API database, a separate approved staging project, and its owner. Configure credentials securely in the server environment; no service-role/browser keys are needed for this existing pg architecture.
2. Install the official Supabase CLI and authenticate interactively. It was not available in this session; no project was linked.
3. In a disposable staging checkout, run supabase init and supabase link for the approved staging reference. Inspect supabase migration list. Capture/review the existing schema with supabase db pull before adding this forward migration to its history. Do not treat auth.schema_migrations as application migration history.
4. Reconcile missing auth tables against the deployed API's schema. Review Data API exposure and table/column grants. Prefer no anon/authenticated direct access for this custom-session API architecture; retain least-privilege server access. Any grant/RLS changes must be a separately reviewed forward migration. Do not add fake auth.uid() policies.
5. Review and apply the language migration to isolated PostgreSQL, then staging. Validate constraint rejection, preserved row counts, two-user separation, forged IDs, expired sessions, fresh-device login and error handling. The current SQLite tests are not proof of PostgreSQL migration/RLS correctness.
6. Finish and review Kannada translation coverage and UI QA before deployment. Create a Vercel preview with staging-only environment variables. Do not point it to production implicitly.
7. Obtain explicit approval for the exact production project, SQL and commit. Apply the reviewed migration before deploying code that saves preferences. No production deployment or migration is authorised by these instructions alone.
8. Verify language saving, reload/login persistence, independent simultaneous users and existing PMS/channel flows. Prefer a forward fix if rollback is needed; do not reset/drop the production database.

Official references: https://supabase.com/docs/guides/deployment/managing-environments and https://supabase.com/docs/guides/database/postgres/row-level-security

## Executed tests

32 Node server tests passed, including auth, roles, staff CRUD/deactivation, reservations/business rules and three new preference tests. Preference storage/constraints were tested with in-memory SQLite only. Production PostgreSQL migration application, Supabase RLS enforcement and authenticated multi-device persistence were NOT tested.
