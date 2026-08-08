const {
  recordAppliedMigration,
} = require("./migrationStore");

const {
  containsTransactionControl:
    detectTransactionControl,
} = require("./migrationCatalog");

class MigrationRunnerError extends Error {
  constructor(
    code,
    message,
    details = {},
    cause = null
  ) {
    super(message);

    this.name = "MigrationRunnerError";
    this.code = code;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }
  }
}

function assertQueryClient(client) {
  if (
    !client ||
    typeof client.query !== "function"
  ) {
    throw new TypeError(
      "Um client PostgreSQL válido é obrigatório."
    );
  }
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(
      `${name} deve ser uma função.`
    );
  }
}

function normalizeMigrationForExecution(
  input = {}
) {
  const id = String(
    input.id || ""
  ).trim();

  const filename = String(
    input.filename || ""
  ).trim();

  const checksum = String(
    input.checksum || ""
  )
    .trim()
    .toLowerCase();

  const sql =
    typeof input.sql === "string"
      ? input.sql.trim()
      : "";

  const containsTransactionControl =
    input.containsTransactionControl ===
      true ||
    (
      Boolean(sql) &&
      detectTransactionControl(sql)
    );

  if (!id) {
    throw new MigrationRunnerError(
      "INVALID_MIGRATION_ID",
      "A migration não possui ID."
    );
  }

  if (!filename) {
    throw new MigrationRunnerError(
      "INVALID_MIGRATION_FILENAME",
      "A migration não possui nome de arquivo.",
      {
        id,
      }
    );
  }

  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new MigrationRunnerError(
      "INVALID_MIGRATION_CHECKSUM",
      "A migration possui checksum inválido.",
      {
        id,
        filename,
      }
    );
  }

  if (!sql) {
    throw new MigrationRunnerError(
      "EMPTY_MIGRATION_SQL",
      "A migration não possui SQL executável.",
      {
        id,
        filename,
      }
    );
  }

  if (containsTransactionControl) {
    throw new MigrationRunnerError(
      "MIGRATION_TRANSACTION_CONTROL_FORBIDDEN",
      "A migration possui controle transacional interno.",
      {
        id,
        filename,
      }
    );
  }

  return {
    id,
    filename,
    checksum,
    sql,
    containsTransactionControl: false,
  };
}

function assertMigrationPlanSafe(
  plan,
  options = {}
) {
  if (
    !plan ||
    typeof plan !== "object"
  ) {
    throw new TypeError(
      "Um plano de migrations válido é obrigatório."
    );
  }

  const checksumMismatches =
    Array.isArray(
      plan.checksumMismatches
    )
      ? plan.checksumMismatches
      : [];

  const missingFiles =
    Array.isArray(plan.missingFiles)
      ? plan.missingFiles
      : [];

  const historyMismatches =
    Array.isArray(
      plan.historyMismatches
    )
      ? plan.historyMismatches
      : [];

  const baselinePending =
    Array.isArray(plan.baselinePending)
      ? plan.baselinePending
      : [];

  const executablePending =
    Array.isArray(
      plan.executablePending
    )
      ? plan.executablePending
      : [];

  const hasDrift =
    plan.hasDrift === true ||
    checksumMismatches.length > 0 ||
    historyMismatches.length > 0 ||
    missingFiles.length > 0;

  if (hasDrift) {
    throw new MigrationRunnerError(
      "MIGRATION_DRIFT_DETECTED",
      "O catálogo de migrations diverge do histórico aplicado.",
      {
        checksumMismatches:
          checksumMismatches.map(
            (item) => item.id
          ),
        missingFiles:
          missingFiles.map(
            (item) => item.id
          ),
        historyMismatches:
          historyMismatches.map(
            (item) => ({
              id: item.id,
              fields:
                Array.isArray(
                  item.fields
                )
                  ? item.fields
                  : [],
            })
          ),
      }
    );
  }

  const allowBaselinePending =
    options.allowBaselinePending === true;

  if (
    baselinePending.length > 0 &&
    !allowBaselinePending
  ) {
    throw new MigrationRunnerError(
      "MIGRATION_BASELINE_REQUIRED",
      "Existem migrations de baseline ainda não registradas.",
      {
        baselinePending:
          baselinePending.map(
            (migration) =>
              migration.id
          ),
      }
    );
  }

  const pendingMigrations = [
    ...baselinePending,
    ...executablePending,
  ];

  const migrationsWithTransactionControl =
    pendingMigrations.filter(
      (migration) => {
        if (!migration) {
          return false;
        }

        if (
          migration
            .containsTransactionControl ===
          true
        ) {
          return true;
        }

        return Boolean(
          typeof migration.sql ===
            "string" &&
          migration.sql.trim() &&
          detectTransactionControl(
            migration.sql
          )
        );
      }
    );

  if (
    migrationsWithTransactionControl
      .length > 0
  ) {
    throw new MigrationRunnerError(
      "MIGRATION_TRANSACTION_CONTROL_FORBIDDEN",
      "Uma migration pendente possui controle transacional interno.",
      {
        migrations:
          migrationsWithTransactionControl.map(
            (migration) =>
              migration.id
          ),
      }
    );
  }

  return true;
}

function calculateExecutionMs(
  startedAt,
  finishedAt
) {
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt)
  ) {
    throw new MigrationRunnerError(
      "INVALID_MIGRATION_CLOCK",
      "O relógio de execução retornou um valor inválido."
    );
  }

  return Math.max(
    0,
    Math.round(
      finishedAt - startedAt
    )
  );
}

async function executeMigrationTransaction(
  client,
  input,
  options = {}
) {
  assertQueryClient(client);

  const migration =
    normalizeMigrationForExecution(
      input
    );

  const recordMigration =
    options.recordMigration ||
    recordAppliedMigration;

  const now =
    options.now ||
    Date.now;

  const baseline =
    options.baseline === true;

  assertFunction(
    recordMigration,
    "recordMigration"
  );

  assertFunction(
    now,
    "now"
  );

  let transactionStarted = false;

  try {
    await client.query("BEGIN");

    transactionStarted = true;

    const startedAt = now();

    await client.query(
      migration.sql
    );

    const finishedAt = now();

    const executionMs =
      calculateExecutionMs(
        startedAt,
        finishedAt
      );

    const appliedRow =
      await recordMigration(
        client,
        {
          id: migration.id,
          filename:
            migration.filename,
          checksum:
            migration.checksum,
          baseline,
          executionMs,
        }
      );

    await client.query("COMMIT");

    return {
      id: migration.id,
      filename:
        migration.filename,
      checksum:
        migration.checksum,
      baseline,
      executionMs,
      appliedRow,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch (rollbackError) {
        throw new MigrationRunnerError(
          "MIGRATION_ROLLBACK_FAILED",
          "A migration falhou e o rollback também falhou.",
          {
            id: migration.id,
            filename:
              migration.filename,
            originalError:
              error &&
              error.message
                ? error.message
                : String(error),
            rollbackError:
              rollbackError &&
              rollbackError.message
                ? rollbackError.message
                : String(
                    rollbackError
                  ),
          },
          error
        );
      }
    }

    throw new MigrationRunnerError(
      "MIGRATION_EXECUTION_FAILED",
      "A execução transacional da migration falhou.",
      {
        id: migration.id,
        filename:
          migration.filename,
        originalError:
          error &&
          error.message
            ? error.message
            : String(error),
      },
      error
    );
  }
}

module.exports = {
  MigrationRunnerError,
  assertMigrationPlanSafe,
  calculateExecutionMs,
  executeMigrationTransaction,
  normalizeMigrationForExecution,
};
