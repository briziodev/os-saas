const path = require("node:path");

const {
  HISTORICAL_BASELINE_FILES,
  buildMigrationPlan,
  discoverMigrations,
} = require("./migrationCatalog");

const {
  assertMigrationPlanSafe,
  executeMigrationTransaction,
} = require("./migrationRunner");

const {
  acquireMigrationLock,
  readMigrationState,
  releaseMigrationLock,
} = require("./migrationStore");

const CANONICAL_BASELINE_FILENAME =
  "20260802000000_baseline_current_schema.sql";

const LEGACY_HISTORICAL_FILENAMES =
  Object.freeze(
    HISTORICAL_BASELINE_FILES.filter(
      (filename) =>
        filename !==
        CANONICAL_BASELINE_FILENAME
    )
  );

const DEFAULT_LEGACY_MIGRATIONS_DIRECTORY =
  path.join(
    __dirname,
    "..",
    "migrations",
    "legacy"
  );

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
  const legacyDirectory =
    options.legacyDirectory ||
    DEFAULT_LEGACY_MIGRATIONS_DIRECTORY;

  const versionsDirectory =
    options.versionsDirectory ||
    DEFAULT_VERSION_MIGRATIONS_DIRECTORY;

  const [
    legacyMigrations,
    versionMigrations,
  ] = await Promise.all([
    discoverMigrations({
      migrationsDirectory:
        legacyDirectory,
    }),

    discoverMigrations({
      migrationsDirectory:
        versionsDirectory,
    }),
  ]);

  const unsafeLegacy =
    legacyMigrations.filter(
      (migration) =>
        migration
          .historicalBaseline !==
        true
    );

  if (unsafeLegacy.length > 0) {
    throw new MigrationOrchestratorError(
      "UNSAFE_LEGACY_MIGRATION",
      "O diretório legacy contém migration que não pertence ao histórico de baseline.",
      {
        migrations:
          unsafeLegacy.map(
            (migration) =>
              migration.filename
          ),
      }
    );
  }

  const legacyFilenameSet =
    new Set(
      legacyMigrations.map(
        (migration) =>
          migration.filename
      )
    );

  const missingLegacyHistory =
    LEGACY_HISTORICAL_FILENAMES.filter(
      (filename) =>
        !legacyFilenameSet.has(
          filename
        )
    );

  if (
    missingLegacyHistory.length > 0
  ) {
    throw new MigrationOrchestratorError(
      "MISSING_LEGACY_HISTORY_FILE",
      "Arquivos históricos obrigatórios estão ausentes do diretório legacy.",
      {
        files:
          missingLegacyHistory,
      }
    );
  }

  const canonicalBaseline =
    versionMigrations.find(
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

  const migrations = [
    ...legacyMigrations.map(
      (migration) => ({
        ...migration,
        source: "legacy",
      })
    ),

    ...versionMigrations.map(
      (migration) => ({
        ...migration,
        source: "versions",
      })
    ),
  ];

  const migrationById =
    new Map();

  for (const migration of migrations) {
    const existing =
      migrationById.get(
        migration.id
      );

    if (existing) {
      throw new MigrationOrchestratorError(
        "DUPLICATE_MIGRATION_ID_ACROSS_DIRECTORIES",
        "O mesmo ID de migration existe em mais de um diretório.",
        {
          id:
            migration.id,
          files: [
            existing.filename,
            migration.filename,
          ],
        }
      );
    }

    migrationById.set(
      migration.id,
      migration
    );
  }

  const filenameSet =
    new Set(
      migrations.map(
        (migration) =>
          migration.filename
      )
    );

  const missingHistoricalFiles =
    HISTORICAL_BASELINE_FILES.filter(
      (filename) =>
        !filenameSet.has(
          filename
        )
    );

  if (
    missingHistoricalFiles.length > 0
  ) {
    throw new MigrationOrchestratorError(
      "MISSING_HISTORICAL_BASELINE_FILE",
      "O catálogo não contém todos os arquivos históricos obrigatórios.",
      {
        files:
          missingHistoricalFiles,
      }
    );
  }

  migrations.sort(
    (left, right) =>
      left.filename.localeCompare(
        right.filename,
        "en"
      )
  );

  return migrations;
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

  const legacyDirectory =
    options.legacyDirectory ||
    DEFAULT_LEGACY_MIGRATIONS_DIRECTORY;

  const versionsDirectory =
    options.versionsDirectory ||
    DEFAULT_VERSION_MIGRATIONS_DIRECTORY;

  const dependencies =
    resolveDependencies(
      options.dependencies
    );

  async function status() {
    const migrations =
      await dependencies
        .discoverMigrationCatalog({
          legacyDirectory,
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
          legacyDirectory,
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

  return Object.freeze({
    status,
    migrate,
  });
}

module.exports = {
  CANONICAL_BASELINE_FILENAME,
  DEFAULT_LEGACY_MIGRATIONS_DIRECTORY,
  DEFAULT_VERSION_MIGRATIONS_DIRECTORY,
  LEGACY_HISTORICAL_FILENAMES,
  MigrationOrchestratorError,
  createMigrationOrchestrator,
  discoverMigrationCatalog,
  summarizePlan,
};