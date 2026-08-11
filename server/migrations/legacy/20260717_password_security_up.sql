BEGIN;

ALTER TABLE public.users
  ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN password_changed_at TIMESTAMPTZ NULL;

ALTER TABLE public.users
  ADD CONSTRAINT users_session_version_positive
  CHECK (session_version >= 1);

CREATE TABLE public.password_reset_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT password_reset_tokens_pkey
    PRIMARY KEY (id),

  CONSTRAINT password_reset_tokens_user_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE,

  CONSTRAINT password_reset_tokens_token_hash_unique
    UNIQUE (token_hash),

  CONSTRAINT password_reset_tokens_hash_length
    CHECK (CHAR_LENGTH(token_hash) = 64),

  CONSTRAINT password_reset_tokens_expiry_after_creation
    CHECK (expires_at > created_at),

  CONSTRAINT password_reset_tokens_terminal_state
    CHECK (
      NOT (
        used_at IS NOT NULL
        AND revoked_at IS NOT NULL
      )
    )
);

CREATE INDEX password_reset_tokens_user_created_idx
  ON public.password_reset_tokens (user_id, created_at DESC);

CREATE INDEX password_reset_tokens_expires_at_idx
  ON public.password_reset_tokens (expires_at);

CREATE UNIQUE INDEX password_reset_tokens_one_pending_per_user_idx
  ON public.password_reset_tokens (user_id)
  WHERE used_at IS NULL
    AND revoked_at IS NULL;

COMMIT;
