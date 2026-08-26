CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY,
  company_id integer NOT NULL,
  actor_user_id integer,
  actor_role character varying(40),
  action character varying(80) NOT NULL,
  entity_type character varying(80) NOT NULL,
  entity_id bigint,
  request_id character varying(120),
  ip character varying(128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_pkey
    PRIMARY KEY (id),

  CONSTRAINT audit_logs_company_id_positive
    CHECK (company_id > 0),

  CONSTRAINT audit_logs_actor_user_id_positive
    CHECK (
      actor_user_id IS NULL OR
      actor_user_id > 0
    ),

  CONSTRAINT audit_logs_entity_id_positive
    CHECK (
      entity_id IS NULL OR
      entity_id > 0
    ),

  CONSTRAINT audit_logs_action_nonempty
    CHECK (btrim(action) <> ''),

  CONSTRAINT audit_logs_entity_type_nonempty
    CHECK (btrim(entity_type) <> ''),

  CONSTRAINT audit_logs_metadata_object
    CHECK (
      jsonb_typeof(metadata) = 'object'
    )
);

CREATE INDEX idx_audit_logs_company_created
  ON public.audit_logs
  (company_id, created_at DESC);

CREATE INDEX idx_audit_logs_company_action_created
  ON public.audit_logs
  (company_id, action, created_at DESC);

CREATE INDEX idx_audit_logs_entity_lookup
  ON public.audit_logs
  (company_id, entity_type, entity_id, created_at DESC);

CREATE INDEX idx_audit_logs_created_at
  ON public.audit_logs
  (created_at);
