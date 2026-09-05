const {
  AUDIT_ACTIONS,
} = require("./auditLog");

const MODE_DRY_RUN = "DRY_RUN";
const MODE_APPLY = "APPLY";
const ACTION_ALL = "ALL";

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_DELETE_PER_RUN = 5000;

const AUDIT_RETENTION_ADVISORY_LOCK_KEY =
  2026090501;

class AuditLogRetentionError extends Error {
  constructor(code, message, details = {}) {
    super(message);

    this.name = "AuditLogRetentionError";
    this.code = code;
    this.details = details;
  }
}

function assertQueryClient(db) {
  if (
    !db ||
    typeof db.query !== "function"
  ) {
    throw new TypeError(
      "Um client PostgreSQL válido é obrigatório."
    );
  }
}

function normalizeRetentionDays(value) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new AuditLogRetentionError(
      "INVALID_RETENTION_DAYS",
      "retentionDays deve ser um inteiro positivo."
    );
  }

  return parsed;
}

function normalizePositiveInteger(
  value,
  {
    name,
    defaultValue,
  }
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new AuditLogRetentionError(
      "INVALID_RETENTION_LIMIT",
      `${name} deve ser um inteiro positivo.`,
      {
        field: name,
      }
    );
  }

  return parsed;
}

function normalizeAuditAction(value) {
  const normalized =
    String(value || "")
      .trim()
      .toUpperCase();

  const allowedActions =
    new Set([
      ...Object.values(AUDIT_ACTIONS),
      ACTION_ALL,
    ]);

  if (
    !normalized ||
    !allowedActions.has(normalized)
  ) {
    throw new AuditLogRetentionError(
      "INVALID_AUDIT_ACTION",
      "Ação de auditoria inválida.",
      {
        action: normalized || null,
      }
    );
  }

  return normalized;
}

function normalizeRetentionMode(
  value = MODE_DRY_RUN
) {
  const normalized =
    String(value || MODE_DRY_RUN)
      .trim()
      .toUpperCase();

  if (
    normalized === MODE_DRY_RUN ||
    normalized === MODE_APPLY
  ) {
    return normalized;
  }

  throw new AuditLogRetentionError(
    "INVALID_RETENTION_MODE",
    "Modo de retenção inválido.",
    {
      mode: normalized,
    }
  );
}

function buildApplyConfirmation({
  retentionDays,
  action,
}) {
  const normalizedRetentionDays =
    normalizeRetentionDays(
      retentionDays
    );

  const normalizedAction =
    normalizeAuditAction(
      action
    );

  return [
    "PURGE_AUDIT_LOGS",
    `${normalizedRetentionDays}_DAYS`,
    normalizedAction,
  ].join("_");
}

function normalizeNow(value) {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(
          value === undefined
            ? Date.now()
            : value
        );

  if (
    Number.isNaN(date.getTime())
  ) {
    throw new AuditLogRetentionError(
      "INVALID_RETENTION_NOW",
      "Data de referência inválida."
    );
  }

  return date;
}

function buildRetentionPlan({
  retentionDays,
  action,
  mode,
  now,
  batchSize,
  maxDeletePerRun,
} = {}) {
  const normalizedRetentionDays =
    normalizeRetentionDays(
      retentionDays
    );

  const normalizedAction =
    normalizeAuditAction(
      action
    );

  const normalizedMode =
    normalizeRetentionMode(
      mode
    );

  const normalizedNow =
    normalizeNow(
      now
    );

  const normalizedBatchSize =
    normalizePositiveInteger(
      batchSize,
      {
        name: "batchSize",
        defaultValue:
          DEFAULT_BATCH_SIZE,
      }
    );

  const normalizedMaxDeletePerRun =
    normalizePositiveInteger(
      maxDeletePerRun,
      {
        name: "maxDeletePerRun",
        defaultValue:
          DEFAULT_MAX_DELETE_PER_RUN,
      }
    );

  const cutoff =
    new Date(
      normalizedNow.getTime() -
      (
        normalizedRetentionDays *
        24 *
        60 *
        60 *
        1000
      )
    );

  return {
    mode: normalizedMode,
    retentionDays:
      normalizedRetentionDays,
    action:
      normalizedAction,
    now:
      normalizedNow,
    cutoff,
    batchSize:
      normalizedBatchSize,
    maxDeletePerRun:
      normalizedMaxDeletePerRun,
  };
}

function buildRetentionWhere(plan) {
  if (
    plan.action === ACTION_ALL
  ) {
    return {
      clause:
        "created_at < $1",
      values: [
        plan.cutoff.toISOString(),
      ],
    };
  }

  return {
    clause:
      "created_at < $1 AND action = $2",
    values: [
      plan.cutoff.toISOString(),
      plan.action,
    ],
  };
}

async function countEligible(
  db,
  plan
) {
  const where =
    buildRetentionWhere(plan);

  const result =
    await db.query(
      `
        SELECT
          COUNT(*)::bigint
            AS eligible_count
        FROM audit_logs
        WHERE ${where.clause}
      `,
      where.values
    );

  const rawCount =
    result?.rows?.[0]
      ?.eligible_count ?? "0";

  const count =
    Number(rawCount);

  if (
    !Number.isSafeInteger(count) ||
    count < 0
  ) {
    throw new AuditLogRetentionError(
      "INVALID_ELIGIBLE_COUNT",
      "Quantidade elegível retornada pelo banco é inválida."
    );
  }

  return count;
}

async function groupEligible(
  db,
  plan
) {
  const where =
    buildRetentionWhere(plan);

  const result =
    await db.query(
      `
        SELECT
          action,
          COUNT(*)::bigint
            AS eligible_count
        FROM audit_logs
        WHERE ${where.clause}
        GROUP BY action
        ORDER BY action
      `,
      where.values
    );

  return (
    Array.isArray(result?.rows)
      ? result.rows
      : []
  ).map((row) => ({
    action:
      String(row.action || ""),
    eligibleCount:
      Number(
        row.eligible_count || 0
      ),
  }));
}

async function acquireApplyLock(
  db
) {
  const result =
    await db.query(
      `
        SELECT
          pg_try_advisory_xact_lock($1)
            AS locked
      `,
      [
        AUDIT_RETENTION_ADVISORY_LOCK_KEY,
      ]
    );

  const locked =
    result?.rows?.[0]
      ?.locked === true;

  if (!locked) {
    throw new AuditLogRetentionError(
      "AUDIT_RETENTION_LOCK_UNAVAILABLE",
      "Outra execução de retenção já está em andamento."
    );
  }
}

async function runDryRun(
  db,
  plan
) {
  const eligibleCount =
    await countEligible(
      db,
      plan
    );

  const groups =
    await groupEligible(
      db,
      plan
    );

  return {
    mode:
      plan.mode,
    retentionDays:
      plan.retentionDays,
    action:
      plan.action,
    cutoff:
      plan.cutoff.toISOString(),
    eligibleCount,
    deletedCount: 0,
    groups,
  };
}

async function deleteEligibleBatch(
  db,
  plan
) {
  const where =
    buildRetentionWhere(plan);

  const limitParameter =
    where.values.length + 1;

  const values = [
    ...where.values,
    plan.batchSize,
  ];

  const result =
    await db.query(
      `
        WITH batch AS (
          SELECT id
          FROM audit_logs
          WHERE ${where.clause}
          ORDER BY
            created_at ASC,
            id ASC
          LIMIT $${limitParameter}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM audit_logs
        WHERE id IN (
          SELECT id
          FROM batch
        )
        RETURNING id
      `,
      values
    );

  const deletedCount =
    Number(
      result?.rowCount ??
      (
        Array.isArray(result?.rows)
          ? result.rows.length
          : 0
      )
    );

  if (
    !Number.isSafeInteger(
      deletedCount
    ) ||
    deletedCount < 0
  ) {
    throw new AuditLogRetentionError(
      "INVALID_AUDIT_RETENTION_DELETE_COUNT",
      "Quantidade removida pelo banco é inválida."
    );
  }

  if (
    deletedCount >
    plan.batchSize
  ) {
    throw new AuditLogRetentionError(
      "AUDIT_RETENTION_BATCH_LIMIT_EXCEEDED",
      "O banco informou remoção acima do limite do batch.",
      {
        deletedCount,
        batchSize:
          plan.batchSize,
      }
    );
  }

  return deletedCount;
}


async function runApplyPreflight(
  db,
  plan
) {
  let transactionOpen = false;

  try {
    await db.query("BEGIN");
    transactionOpen = true;

    await acquireApplyLock(db);

    const eligibleCount =
      await countEligible(
        db,
        plan
      );

    if (
      eligibleCount >
      plan.maxDeletePerRun
    ) {
      throw new AuditLogRetentionError(
        "AUDIT_RETENTION_DELETE_LIMIT_EXCEEDED",
        "Quantidade elegível excede o limite máximo permitido por execução.",
        {
          eligibleCount,
          maxDeletePerRun:
            plan.maxDeletePerRun,
        }
      );
    }

    const groups =
      await groupEligible(
        db,
        plan
      );

    let deletedCount = 0;

    while (
      deletedCount <
      eligibleCount
    ) {
      const batchDeleted =
        await deleteEligibleBatch(
          db,
          plan
        );

      deletedCount +=
        batchDeleted;

      if (
        deletedCount >
        eligibleCount
      ) {
        throw new AuditLogRetentionError(
          "AUDIT_RETENTION_POSTCHECK_FAILED",
          "A quantidade removida excedeu o preflight.",
          {
            eligibleCount,
            deletedCount,
          }
        );
      }

      if (
        batchDeleted === 0
      ) {
        break;
      }
    }

    const remainingCount =
      await countEligible(
        db,
        plan
      );

    if (
      deletedCount !==
        eligibleCount ||
      remainingCount !== 0
    ) {
      throw new AuditLogRetentionError(
        "AUDIT_RETENTION_POSTCHECK_FAILED",
        "A pós-validação da retenção não confirmou a remoção esperada.",
        {
          eligibleCount,
          deletedCount,
          remainingCount,
        }
      );
    }

    await db.query("COMMIT");
    transactionOpen = false;

    return {
      mode:
        plan.mode,
      retentionDays:
        plan.retentionDays,
      action:
        plan.action,
      cutoff:
        plan.cutoff.toISOString(),
      eligibleCount,
      deletedCount,
      groups,
    };
  } catch (error) {
    if (transactionOpen) {
      await db
        .query("ROLLBACK")
        .catch(() => {});
    }

    throw error;
  }
}


async function runApplyWithDedicatedClient(
  db,
  plan
) {
  /*
   * Quando recebemos um pg.Pool, APPLY precisa
   * usar um client dedicado para garantir que:
   *
   * BEGIN
   * advisory lock
   * COUNT
   * DELETE
   * pós-validação
   * COMMIT / ROLLBACK
   *
   * ocorram na mesma sessão PostgreSQL.
   *
   * Fake clients e clients PostgreSQL já
   * adquiridos continuam suportados diretamente.
   */
  if (
    typeof db.connect !== "function"
  ) {
    return runApplyPreflight(
      db,
      plan
    );
  }

  const client =
    await db.connect();

  if (
    !client ||
    typeof client.query !== "function"
  ) {
    if (
      client &&
      typeof client.release === "function"
    ) {
      client.release();
    }

    throw new TypeError(
      "Pool PostgreSQL retornou um client inválido."
    );
  }

  try {
    return await runApplyPreflight(
      client,
      plan
    );
  } finally {
    if (
      typeof client.release === "function"
    ) {
      client.release();
    }
  }
}




async function runAuditLogRetention(
  db,
  options = {}
) {
  assertQueryClient(db);

  const plan =
    buildRetentionPlan(
      options
    );

  if (
    plan.mode === MODE_APPLY
  ) {
    const expectedConfirmation =
      buildApplyConfirmation({
        retentionDays:
          plan.retentionDays,
        action:
          plan.action,
      });

    const receivedConfirmation =
      String(
        options.confirmation || ""
      ).trim();

    if (
      receivedConfirmation !==
      expectedConfirmation
    ) {
      throw new AuditLogRetentionError(
        "INVALID_APPLY_CONFIRMATION",
        "Confirmação explícita de APPLY inválida.",
        {
          expectedConfirmation,
        }
      );
    }

return runApplyWithDedicatedClient(
  db,
  plan
);
  }

  return runDryRun(
    db,
    plan
  );
}

module.exports = {
  ACTION_ALL,
  AUDIT_RETENTION_ADVISORY_LOCK_KEY,
  AuditLogRetentionError,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_DELETE_PER_RUN,
  MODE_APPLY,
  MODE_DRY_RUN,
  buildApplyConfirmation,
  buildRetentionPlan,
  normalizeAuditAction,
  normalizeRetentionDays,
  normalizeRetentionMode,
  runAuditLogRetention,
};