const DISCARD_ALLOWED_ROLES = new Set([
  "admin",
  "atendimento",
]);

const DISCARD_ALLOWED_STATUSES = new Set([
  "triagem",
  "cancelado",
]);

function normalizeNullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeMoney(value) {
  const number = Number(value || 0);

  return Number.isFinite(number)
    ? number
    : 0;
}

function canDiscardOS({
  role,
  status,
  discardLockedAt,
  hasParts,
  hasBlockingEvents,
} = {}) {
  return (
    DISCARD_ALLOWED_ROLES.has(role) &&
    DISCARD_ALLOWED_STATUSES.has(status) &&
    discardLockedAt === null &&
    hasParts === false &&
    hasBlockingEvents === false
  );
}

function shouldLockDiscardOnUpdate({
  role,
  current = {},
  next = {},
} = {}) {
  if (
    current.discard_locked_at !== null &&
    current.discard_locked_at !== undefined
  ) {
    return false;
  }

  const currentStatus =
    String(current.status || "").trim();

  const nextStatus =
    next.status === undefined
      ? currentStatus
      : String(next.status || "").trim();

  const statusChanged =
    nextStatus !== currentStatus;

  if (
    statusChanged &&
    nextStatus !== "cancelado"
  ) {
    return true;
  }

  if (role === "tecnico") {
    const descriptionChanged =
      next.problema_relatado !== undefined &&
      normalizeNullableText(
        current.problema_relatado
      ) !==
        normalizeNullableText(
          next.problema_relatado
        );

    return (
      statusChanged ||
      descriptionChanged
    );
  }

  if (next.mao_obra !== undefined) {
    const laborChanged =
      normalizeMoney(current.mao_obra) !==
      normalizeMoney(next.mao_obra);

    if (laborChanged) {
      return true;
    }
  }

  return false;
}

module.exports = {
  DISCARD_ALLOWED_ROLES,
  DISCARD_ALLOWED_STATUSES,
  canDiscardOS,
  shouldLockDiscardOnUpdate,
};
