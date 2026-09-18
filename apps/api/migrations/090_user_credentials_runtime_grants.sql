-- Profile "change password" updates user_credentials under RLS (app.actor).
-- Table privileges for the runtime role are applied by apps/api/scripts/migrate.ts
-- at the end of every migrate run; this script exists so deploy checklists that
-- apply pending migrations also re-run those grants.
SELECT 1;
