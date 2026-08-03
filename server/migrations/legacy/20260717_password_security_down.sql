BEGIN;

DROP TABLE IF EXISTS public.password_reset_tokens;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_session_version_positive;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS password_changed_at,
  DROP COLUMN IF EXISTS session_version;

COMMIT;
