const path = require("node:path");

const {
  createBaselineSchemaVerifier,
} = require("./baselineSchemaVerifier");

const {
  buildMigrationPlan,
  discoverMigrations,
} = require("./migrationCatalog");

const {
  assertMigrationPlanSafe,
  executeMigrationTransaction,
  registerBaselineTransaction,
} = require("./migrationRunner");

const {
  acquireMigrationLock,
  ensureMetadataTable,
  readMigrationState,
  releaseMigrationLock,
} = require("./migrationStore");

const CANONICAL_BASELINE_FILENAME =
  "20260802000000_baseline_current_schema.sql";

const BASELINE_MODE_REGISTER_EXISTING =
  "register-existing";

const BASELINE_MODE_APPLY_EMPTY =
  "apply-empty";

const DEFAULT_VERSION_MIGRATIONS_DIRECTORY =
  path.join(
    __dirname,
    "..",
    "migrations",
    "versions"
  );

class MigrationOrchestratorError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    cause = null
  ) {
    super(message);

    this.name =
      "MigrationOrchestratorError";

    this.code = code;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }
  }
}

function assertFunction(
  value,
  name
) {
  if (typeof value !== "function") {
    throw new TypeError(
      name + " deve ser uma função."
    );
  }
}

function assertPool(pool) {
  if (
    !pool ||
    typeof pool.connect !== "function"
  ) {
    throw new TypeError(
      "Um pool PostgreSQL válido é obrigatório."
    );
  }
}

function assertPoolClient(client) {
  if (
    !client ||
    typeof client.query !== "function" ||
    typeof client.release !==
      "function"
  ) {
    throw new TypeError(
      "O pool não retornou um client PostgreSQL válido."
    );
  }
}

function assertBaselineVerifier(
  verifier
) {
  if (
    !verifier ||
    typeof verifier
      .verifyExistingSchema !==
      "function" ||
    typeof verifier.verifyEmpty !==
      "function"
  ) {
    throw new TypeError(
      "Um baseline verifier válido é obrigatório."
    );
  }
}

function normalizeBaselineMode(
  value
) {
  const mode =
    String(value || "")
      .trim();

  if (
    mode !==
      BASELINE_MODE_REGISTER_EXISTING &&
    mode !==
      BASELINE_MODE_APPLY_EMPTY
  ) {
    throw new MigrationOrchestratorError(
      "INVALID_BASELINE_MODE",
      "O modo de baseline deve ser register-existing ou apply-empty.",
      {
        mode:
          mode || null,
      }
    );
  }

  return mode;
}

function getDefaultPool() {
  return require("../db");
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name:
      error.name ||
      "Error",
    code:
      error.code ||
      null,
    message:
      error.message ||
      String(error),
  };
}

function describeMigration(
  migration
) {
  return {
    id: migration.id,
    filename:
      migration.filename,
    historicalBaseline:
      migration.historicalBaseline ===
      true,
    source:
      migration.source || null,
  };
}

function summarizePlan(plan) {
  const applied =
    Array.isArray(plan.applied)
      ? plan.applied
      : [];

  const pending =
    Array.isArray(plan.pending)
      ? plan.pending
      : [];

  const baselinePending =
    Array.isArray(
      plan.baselinePending
    )
      ? plan.baselinePending
      : [];

  const executablePending =
    Array.isArray(
      plan.executablePending
    )
      ? plan.executablePending
      : [];

  const checksumMismatches =
    Array.isArray(
      plan.checksumMismatches
    )
      ? plan.checksumMismatches
      : [];

  const historyMismatches =
    Array.isArray(
      plan.historyMismatches
    )
      ? plan.historyMismatches
      : [];

  const missingFiles =
    Array.isArray(
      plan.missingFiles
    )
      ? plan.missingFiles
      : [];

  return {
    hasDrift:
      plan.hasDrift === true,

    counts: {
      applied:
        applied.length,
      pending:
        pending.length,
      baselinePending:
        baselinePending.length,
      executablePending:
        executablePending.length,
      checksumMismatches:
        checksumMismatches.length,
      historyMismatches:
        historyMismatches.length,
      missingFiles:
        missingFiles.length,
    },

    applied:
      applied.map((item) =>
        describeMigration(
          item.migration
        )
      ),

    pending:
      pending.map(
        describeMigration
      ),

    baselinePending:
      baselinePending.map(
        describeMigration
      ),

    executablePending:
      executablePending.map(
        describeMigration
      ),

    checksumMismatches:
      checksumMismatches.map(
        (item) => ({
          id: item.id,
          filename:
            item.filename || null,
        })
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

    missingFiles:
      missingFiles.map(
        (item) => ({
          id: item.id,
          filename:
            item.filename || null,
          baseline:
            item.baseline,
        })
      ),
  };
}

async function discoverMigrationCatalog(
  options = {}
) {
  const versionsDirectory =
    options.versionsDirectory ||
    DEFAULT_VERSION_MIGRATIONS_DIRECTORY;

  const migrations =
    await discoverMigrations({
      migrationsDirectory:
        versionsDirectory,
    });

  const canonicalBaseline =
    migrations.find(
      (migration) =>
        migration.filename ===
        CANONICAL_BASELINE_FILENAME
    );

  if (
    !canonicalBaseline ||
    canonicalBaseline
      .historicalBaseline !== true
  ) {
    throw new MigrationOrchestratorError(
      "MISSING_CANONICAL_BASELINE",
      "A baseline canônica obrigatória não foi encontrada em migrations/versions.",
      {
        filename:
          CANONICAL_BASELINE_FILENAME,
      }
    );
  }

  return migrations.map(
    (migration) => ({
      ...migration,
      source: "versions",
    })
  );
}

function resolveDependencies(
  overrides = {}
) {
  const dependencies = {
    discoverMigrationCatalog:
      overrides
        .discoverMigrationCatalog ||
      discoverMigrationCatalog,

    readMigrationState:
      overrides
        .readMigrationState ||
      readMigrationState,

    buildMigrationPlan:
      overrides
        .buildMigrationPlan ||
      buildMigrationPlan,

    assertMigrationPlanSafe:
      overrides
        .assertMigrationPlanSafe ||
      assertMigrationPlanSafe,

    acquireMigrationLock:
      overrides
        .acquireMigrationLock ||
      acquireMigrationLock,

    releaseMigrationLock:
      overrides
        .releaseMigrationLock ||
      releaseMigrationLock,

    executeMigrationTransaction:
      overrides
        .executeMigrationTransaction ||
      executeMigrationTransaction,

    registerBaselineTransaction:
      overrides
        .registerBaselineTransaction ||
      registerBaselineTransaction,

    ensureMetadataTable:
      overrides
        .ensureMetadataTable ||
      ensureMetadataTable,
  };

  for (
    const [
      name,
      dependency,
    ] of Object.entries(
      dependencies
    )
  ) {
    assertFunction(
      dependency,
      name
    );
  }

  return dependencies;
}

function createMigrationOrchestrator(
  options = {}
) {
  const pool =
    options.pool ||
    getDefaultPool();

  assertPool(pool);

  const versionsDirectory =
    options.versionsDirectory ||
    DEFAULT_VERSION_MIGRATIONS_DIRECTORY;

  const dependencies =
    resolveDependencies(
      options.dependencies
    );

  const baselineVerifier =
    options.baselineVerifier ||
    createBaselineSchemaVerifier(
      options.baselineVerifierOptions ||
        {}
    );

  assertBaselineVerifier(
    baselineVerifier
  );

  async function status() {
    const migrations =
      await dependencies
        .discoverMigrationCatalog({
          versionsDirectory,
        });

    const client =
      await pool.connect();

    assertPoolClient(client);

    let operationResult = null;
    let operationError = null;

    try {
      const state =
        await dependencies
          .readMigrationState(
            client
          );

      const plan =
        dependencies
          .buildMigrationPlan({
            migrations,
            appliedRows:
              state.appliedRows,
          });

      operationResult = {
        metadataTableExists:
          state
            .metadataTableExists ===
          true,

        ...summarizePlan(
          plan
        ),
      };
    } catch (error) {
      operationError = error;
    }

    let clientReleaseError =
      null;

    try {
      client.release();
    } catch (error) {
      clientReleaseError =
        error;
    }

    if (clientReleaseError) {
      throw new MigrationOrchestratorError(
        "MIGRATION_CLIENT_RELEASE_FAILED",
        "Não foi possível liberar o client PostgreSQL utilizado pelo status de migrations.",
        {
          operationError:
            serializeError(
              operationError
            ),
          releaseError:
            serializeError(
              clientReleaseError
            ),
        },
        operationError ||
          clientReleaseError
      );
    }

    if (operationError) {
      throw operationError;
    }

    return operationResult;
  }

  async function migrate(
    runOptions = {}
  ) {
    const migrations =
      await dependencies
        .discoverMigrationCatalog({
          versionsDirectory,
        });

    const client =
      await pool.connect();

    assertPoolClient(client);

    let lockAcquired = false;
    let lockAcquisitionUncertain = false;
    let operationResult = null;
    let operationError = null;

    try {
      const lockConfirmed =
        await dependencies
          .acquireMigrationLock(
            client,
            {
              wait:
                runOptions
                  .waitForLock ===
                true,
            }
          );

      if (lockConfirmed !== true) {
        throw new MigrationOrchestratorError(
          "MIGRATION_LOCK_NOT_CONFIRMED",
          "A aquisição do advisory lock de migrations não foi confirmada."
        );
      }

      lockAcquired = true;

      const state =
        await dependencies
          .readMigrationState(
            client
          );

      const plan =
        dependencies
          .buildMigrationPlan({
            migrations,
            appliedRows:
              state.appliedRows,
          });

      dependencies
        .assertMigrationPlanSafe(
          plan
        );

      const executed = [];

      for (
        const migration of
        plan.executablePending
      ) {
        const result =
          await dependencies
            .executeMigrationTransaction(
              client,
              migration
            );

        executed.push({
          id: result.id,
          filename:
            result.filename,
          baseline:
            result.baseline,
          executionMs:
            result.executionMs,
        });
      }

      operationResult = {
        metadataTableExists:
          state
            .metadataTableExists ===
          true,

        before:
          summarizePlan(
            plan
          ),

        executed,
      };
    } catch (error) {
      operationError = error;

      if (
        !lockAcquired &&
        error &&
        error.code !==
          "MIGRATION_LOCK_UNAVAILABLE" &&
        error.code !==
          "MIGRATION_LOCK_NOT_CONFIRMED"
      ) {
        lockAcquisitionUncertain =
          true;
      }
    }

    let lockReleaseError =
      null;

    if (lockAcquired) {
      try {
        const released =
          await dependencies
            .releaseMigrationLock(
              client
            );

        if (released !== true) {
          lockReleaseError =
            new Error(
              "PostgreSQL não confirmou a liberação do advisory lock."
            );
        }
      } catch (error) {
        lockReleaseError =
          error;
      }
    }

    const operationRequiresClientDestroy =
      Boolean(
        operationError &&
        operationError.code ===
          "MIGRATION_ROLLBACK_FAILED"
      );

    const destroyClient =
      Boolean(
        lockReleaseError ||
        operationRequiresClientDestroy ||
        lockAcquisitionUncertain
      );

    let clientReleaseError =
      null;

    try {
      client.release(
        destroyClient
      );
    } catch (error) {
      clientReleaseError =
        error;
    }

    if (clientReleaseError) {
      throw new MigrationOrchestratorError(
        "MIGRATION_CLIENT_RELEASE_FAILED",
        "Não foi possível liberar o client PostgreSQL do orchestrator.",
        {
          operationError:
            serializeError(
              operationError
            ),
          lockReleaseError:
            serializeError(
              lockReleaseError
            ),
          clientReleaseError:
            serializeError(
              clientReleaseError
            ),
        },
        operationError ||
          clientReleaseError
      );
    }

    if (lockReleaseError) {
      throw new MigrationOrchestratorError(
        "MIGRATION_LOCK_RELEASE_FAILED",
        "Não foi possível confirmar a liberação do advisory lock de migrations.",
        {
          operationError:
            serializeError(
              operationError
            ),
          lockReleaseError:
            serializeError(
              lockReleaseError
            ),
        },
        operationError ||
          lockReleaseError
      );
    }

    if (operationError) {
      throw operationError;
    }

    return operationResult;
  }

  async function baseline(
    runOptions = {}
  ) {
    const mode =
      normalizeBaselineMode(
        runOptions.mode
      );

    const migrations =
      await dependencies
        .discoverMigrationCatalog({
          versionsDirectory,
        });

    const client =
      await pool.connect();

    assertPoolClient(client);

    let lockAcquired = false;
    let lockAcquisitionUncertain = false;
    let baselineExecutionAttempted =
      false;
    let operationResult = null;
    let operationError = null;

    try {
      const lockConfirmed =
        await dependencies
          .acquireMigrationLock(
            client,
            {
              wait:
                runOptions
                  .waitForLock ===
                true,
            }
          );

      if (lockConfirmed !== true) {
        throw new MigrationOrchestratorError(
          "MIGRATION_LOCK_NOT_CONFIRMED",
          "A aquisição do advisory lock de migrations não foi confirmada."
        );
      }

      lockAcquired = true;

      const state =
        await dependencies
          .readMigrationState(
            client
          );

      if (
        state
          .metadataTableExists ===
          true ||
        (
          Array.isArray(
            state.appliedRows
          ) &&
          state.appliedRows.length >
            0
        )
      ) {
        throw new MigrationOrchestratorError(
          "MIGRATION_BASELINE_ALREADY_INITIALIZED",
          "A baseline explícita só pode inicializar um banco ainda sem metadata de migrations."
        );
      }

      const plan =
        dependencies
          .buildMigrationPlan({
            migrations,
            appliedRows:
              state.appliedRows,
          });

      dependencies
        .assertMigrationPlanSafe(
          plan,
          {
            allowBaselinePending:
              true,
          }
        );

      const baselinePending =
        Array.isArray(
          plan.baselinePending
        )
          ? plan.baselinePending
          : [];

      const canonicalBaseline =
        baselinePending.find(
          (migration) =>
            migration &&
            migration.filename ===
              CANONICAL_BASELINE_FILENAME &&
            migration
              .historicalBaseline ===
              true
        );

      if (
        baselinePending.length !==
          1 ||
        !canonicalBaseline
      ) {
        throw new MigrationOrchestratorError(
          "MIGRATION_CANONICAL_BASELINE_NOT_PENDING",
          "A baseline canônica precisa ser a única baseline histórica pendente.",
          {
            baselinePending:
              baselinePending.map(
                (migration) =>
                  migration &&
                  migration.filename
                    ? migration.filename
                    : null
              ),
          }
        );
      }

      let verification = null;
      let result = null;

      if (
        mode ===
        BASELINE_MODE_REGISTER_EXISTING
      ) {
        verification =
          await baselineVerifier
            .verifyExistingSchema();

        if (
          !verification ||
          !verification.baseline ||
          verification
            .baseline
            .checksum !==
            canonicalBaseline.checksum
        ) {
          throw new MigrationOrchestratorError(
            "MIGRATION_BASELINE_VERIFICATION_MISMATCH",
            "O verifier e o catálogo não concordam sobre o checksum da baseline canônica."
          );
        }

        result =
          await dependencies
            .registerBaselineTransaction(
              client,
              canonicalBaseline
            );
      } else {
        baselineExecutionAttempted =
          true;

        result =
          await dependencies
            .executeMigrationTransaction(
              client,
              canonicalBaseline,
              {
                baseline: true,

                prepareTransaction:
                  async (
                    receivedClient
                  ) => {
                    verification =
                      await baselineVerifier
                        .verifyEmpty(
                          receivedClient
                        );

                    if (
                      !verification ||
                      !verification
                        .baseline ||
                      verification
                        .baseline
                        .checksum !==
                        canonicalBaseline
                          .checksum
                    ) {
                      throw new MigrationOrchestratorError(
                        "MIGRATION_BASELINE_VERIFICATION_MISMATCH",
                        "O verifier e o catálogo não concordam sobre o checksum da baseline canônica."
                      );
                    }

                    await dependencies
                      .ensureMetadataTable(
                        receivedClient
                      );
                  },
              }
            );
      }

      operationResult = {
        mode,

        baseline: {
          id:
            result.id,
          filename:
            result.filename,
          checksum:
            result.checksum,
          executionMs:
            result.executionMs,
          executedSql:
            mode ===
            BASELINE_MODE_APPLY_EMPTY,
        },

        verification: {
          semanticChecksum:
            verification &&
            verification.schema &&
            verification
              .schema
              .semanticChecksum
              ? verification
                  .schema
                  .semanticChecksum
              : null,

          empty:
            verification &&
            verification.schema &&
            typeof verification
              .schema
              .empty ===
              "boolean"
              ? verification
                  .schema
                  .empty
              : null,
        },

        before:
          summarizePlan(
            plan
          ),
      };
    } catch (error) {
      operationError = error;

      if (
        !lockAcquired &&
        error &&
        error.code !==
          "MIGRATION_LOCK_UNAVAILABLE" &&
        error.code !==
          "MIGRATION_LOCK_NOT_CONFIRMED"
      ) {
        lockAcquisitionUncertain =
          true;
      }
    }

    let lockReleaseError =
      null;

    if (lockAcquired) {
      try {
        const released =
          await dependencies
            .releaseMigrationLock(
              client
            );

        if (released !== true) {
          lockReleaseError =
            new Error(
              "PostgreSQL não confirmou a liberação do advisory lock."
            );
        }
      } catch (error) {
        lockReleaseError =
          error;
      }
    }

    const operationRequiresClientDestroy =
      Boolean(
        operationError &&
        operationError.code ===
          "MIGRATION_ROLLBACK_FAILED"
      );

    const destroyClient =
      Boolean(
        lockReleaseError ||
        operationRequiresClientDestroy ||
        lockAcquisitionUncertain ||
        baselineExecutionAttempted
      );

    let clientReleaseError =
      null;

    try {
      client.release(
        destroyClient
      );
    } catch (error) {
      clientReleaseError =
        error;
    }

    if (clientReleaseError) {
      throw new MigrationOrchestratorError(
        "MIGRATION_CLIENT_RELEASE_FAILED",
        "Não foi possível liberar o client PostgreSQL da operação de baseline.",
        {
          operationError:
            serializeError(
              operationError
            ),
          lockReleaseError:
            serializeError(
              lockReleaseError
            ),
          clientReleaseError:
            serializeError(
              clientReleaseError
            ),
        },
        operationError ||
          clientReleaseError
      );
    }

    if (lockReleaseError) {
      throw new MigrationOrchestratorError(
        "MIGRATION_LOCK_RELEASE_FAILED",
        "Não foi possível confirmar a liberação do advisory lock de migrations.",
        {
          operationError:
            serializeError(
              operationError
            ),
          lockReleaseError:
            serializeError(
              lockReleaseError
            ),
        },
        operationError ||
          lockReleaseError
      );
    }

    if (operationError) {
      throw operationError;
    }

    return operationResult;
  }

  return Object.freeze({
    status,
    migrate,
    baseline,
  });
}

module.exports = {
  BASELINE_MODE_APPLY_EMPTY,
  BASELINE_MODE_REGISTER_EXISTING,
  CANONICAL_BASELINE_FILENAME,
  DEFAULT_VERSION_MIGRATIONS_DIRECTORY,
  MigrationOrchestratorError,
  createMigrationOrchestrator,
  discoverMigrationCatalog,
  summarizePlan,
};