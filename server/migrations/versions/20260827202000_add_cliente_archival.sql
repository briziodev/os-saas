ALTER TABLE public.clientes
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by bigint,
  ADD COLUMN archive_reason varchar(300);

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_archived_by_positive
    CHECK (
      archived_by IS NULL
      OR archived_by > 0
    ),
  ADD CONSTRAINT clientes_archival_state_consistent
    CHECK (
      (
        archived_at IS NULL
        AND archived_by IS NULL
        AND archive_reason IS NULL
      )
      OR
      (
        archived_at IS NOT NULL
        AND archive_reason IS NOT NULL
        AND btrim(archive_reason) <> ''
      )
    ),
  ADD CONSTRAINT clientes_archived_by_fk
    FOREIGN KEY (archived_by)
    REFERENCES public.users(id)
    ON DELETE SET NULL;

CREATE INDEX idx_clientes_company_active
  ON public.clientes (company_id, id)
  WHERE archived_at IS NULL;

CREATE INDEX idx_clientes_company_archived
  ON public.clientes (
    company_id,
    archived_at DESC,
    id DESC
  )
  WHERE archived_at IS NOT NULL;