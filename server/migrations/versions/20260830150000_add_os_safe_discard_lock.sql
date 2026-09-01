-- Controlled hard-delete protection for service orders.
-- Existing orders are protected by default.
-- New application-created orders may explicitly opt into temporary
-- discard eligibility by inserting discard_locked_at = NULL.
--
-- The migration runner owns the transaction.

ALTER TABLE public.ordens_servico
  ADD COLUMN discard_locked_at timestamp with time zone DEFAULT now();

ALTER TABLE public.ordens_servico
  ADD CONSTRAINT ordens_servico_discard_lock_status_consistent
  CHECK (
    discard_locked_at IS NOT NULL
    OR status::text IN ('triagem', 'cancelado')
  );

COMMENT ON COLUMN public.ordens_servico.discard_locked_at IS
  'When non-null, permanently blocks operational hard discard of the service order. NULL is reserved for newly created orders that have not entered operation.';