const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MigrationOrchestratorError,
  createMigrationOrchestrator,
  discoverMigrationCatalog,
} = require(
  "../database/migrationOrchestrator"
);

async function createTemporaryDirectory() {
  return fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "os-saas-orchestrator-"
    )
  );
}

async function writeMigration(
  directory,
  filename,
  sql = "SELECT 1;"
) {
  await fs.writeFile(
    path.join(
      directory,
      filename
    ),
    sql,
    "utf8"
  );
}

async function createCatalogDirectories(
  context
) {
  const root =
    await createTemporaryDirectory();

  const legacyDirectory =
    path.join(
      root,
      "legacy"
    );

  const versionsDirectory =
    path.join(
      root,
      "versions"
    );

  await fs.mkdir(
    legacyDirectory
  );

  await fs.mkdir(
    versionsDirectory
  );

  context.after(async () => {
    await fs.rm(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  });

  return {
    legacyDirectory,
    versionsDirectory,
  };
}

async function writeRequiredCatalog(
  directories
) {
  await writeMigration(
    directories.versionsDirectory,
    "20260802000000_baseline_current_schema.sql",
    "CREATE TABLE baseline_example(id integer);"
  );
}

function createMigration(
  overrides = {}
) {
  return {
    id:
      "20260809120000_future_change",
    filename:
      "20260809120000_future_change.sql",
    checksum:
      "a".repeat(64),
    sql:
      "CREATE TABLE future_change(id integer);",
    historicalBaseline:
      false,
    containsTransactionControl:
      false,
    source:
      "versions",
    ...overrides,
  };
}

function createAppliedRow(
  migration,
  overrides = {}
) {
  return {
    id:
      migration.id,
    filename:
      migration.filename,
    checksum:
      migration.checksum,
    baseline:
      migration
        .historicalBaseline ===
      true,
    applied_at:
      new Date(
        "2026-08-08T20:00:00Z"
      ),
    ...overrides,
  };
}

function createFakePool(
  options = {}
) {
  const releaseCalls = [];

  const client = {
    async query() {
      return {
        rows: [],
      };
    },

    release(destroy) {
      releaseCalls.push(
        destroy === true
      );

      if (
        options.releaseError
      ) {
        throw options.releaseError;
      }
    },
  };

  const pool = {
    connectCalls: 0,

    async connect() {
      this.connectCalls += 1;

      return client;
    },
  };

  return {
    pool,
    client,
    releaseCalls,
  };
}

test(
  "discoverMigrationCatalog usa somente versions com ordem deterministica",
  async (context) => {
    const directories =
      await createCatalogDirectories(
        context
      );

    await writeRequiredCatalog(
      directories
    );

    await writeMigration(
      directories.versionsDirectory,
      "20260809120000_future_change.sql",
      "CREATE TABLE future_change(id integer);"
    );

    const migrations =
      await discoverMigrationCatalog({
        versionsDirectory:
          directories.versionsDirectory,
      });

    assert.deepEqual(
      migrations.map(
        (migration) =>
          migration.filename
      ),
      [
        "20260802000000_baseline_current_schema.sql",
        "20260809120000_future_change.sql",
      ]
    );

    assert.deepEqual(
      migrations.map(
        (migration) =>
          migration.source
      ),
      [
        "versions",
        "versions",
      ]
    );

    assert.equal(
      migrations[0]
        .historicalBaseline,
      true
    );

    assert.equal(
      migrations[1]
        .historicalBaseline,
      false
    );
  }
);
test(
  "discoverMigrationCatalog ignora completamente o diretorio legacy",
  async (context) => {
    const directories =
      await createCatalogDirectories(
        context
      );

    await writeRequiredCatalog(
      directories
    );

    await writeMigration(
      directories.legacyDirectory,
      "arquivo_sem_versao.sql",
      "BEGIN; SELECT 1; COMMIT;"
    );

    const migrations =
      await discoverMigrationCatalog({
        legacyDirectory:
          directories.legacyDirectory,
        versionsDirectory:
          directories.versionsDirectory,
      });

    assert.deepEqual(
      migrations.map(
        (migration) =>
          migration.filename
      ),
      [
        "20260802000000_baseline_current_schema.sql",
      ]
    );

    assert.deepEqual(
      migrations.map(
        (migration) =>
          migration.source
      ),
      [
        "versions",
      ]
    );
  }
);
test(
  "status e somente leitura e nao adquire advisory lock",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const migration =
      createMigration();

    const events = [];

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            events.push(
              "discover"
            );

            return [
              migration,
            ];
          },

          async readMigrationState(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "read"
            );

            return {
              metadataTableExists:
                true,
              appliedRows: [
                createAppliedRow(
                  migration
                ),
              ],
            };
          },

          async acquireMigrationLock() {
            events.push(
              "lock"
            );

            throw new Error(
              "status nao deveria adquirir lock"
            );
          },
        },
      });

    const result =
      await orchestrator.status();

    assert.deepEqual(
      events,
      [
        "discover",
        "read",
      ]
    );

    assert.equal(
      result.hasDrift,
      false
    );

    assert.equal(
      result.counts.applied,
      1
    );

    assert.equal(
      pool.connectCalls,
      1
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "migrate bloqueia baseline pendente e sempre libera lock e client",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baseline =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
        source:
          "versions",
      });

    const events = [];
    let executed = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baseline,
            ];
          },

          async acquireMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "lock"
            );

            return true;
          },

          async readMigrationState(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "read"
            );

            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          async releaseMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "unlock"
            );

            return true;
          },

          async executeMigrationTransaction() {
            executed = true;

            throw new Error(
              "baseline nao deveria executar"
            );
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_BASELINE_REQUIRED"
        );

        return true;
      }
    );

    assert.equal(
      executed,
      false
    );

    assert.deepEqual(
      events,
      [
        "lock",
        "read",
        "unlock",
      ]
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "migrate executa somente executablePending no mesmo client",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baseline =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
        source:
          "versions",
      });

    const future =
      createMigration();

    const events = [];

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baseline,
              future,
            ];
          },

          async acquireMigrationLock(
            receivedClient,
            options
          ) {
            assert.equal(
              receivedClient,
              client
            );

            assert.equal(
              options.wait,
              true
            );

            events.push(
              "lock"
            );

            return true;
          },

          async readMigrationState(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "read"
            );

            return {
              metadataTableExists:
                true,
              appliedRows: [
                createAppliedRow(
                  baseline
                ),
              ],
            };
          },

          async executeMigrationTransaction(
            receivedClient,
            migration
          ) {
            assert.equal(
              receivedClient,
              client
            );

            assert.equal(
              migration.id,
              future.id
            );

            events.push(
              "execute:" +
              migration.id
            );

            return {
              id:
                migration.id,
              filename:
                migration.filename,
              baseline: false,
              executionMs: 14,
            };
          },

          async releaseMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "unlock"
            );

            return true;
          },
        },
      });

    const result =
      await orchestrator.migrate({
        waitForLock: true,
      });

    assert.deepEqual(
      events,
      [
        "lock",
        "read",
        "execute:" +
          future.id,
        "unlock",
      ]
    );

    assert.deepEqual(
      result.executed,
      [
        {
          id:
            future.id,
          filename:
            future.filename,
          baseline: false,
          executionMs: 14,
        },
      ]
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "migrate destroi client quando unlock nao e confirmado",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baseline =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baseline,
            ];
          },

          async acquireMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                true,
              appliedRows: [
                createAppliedRow(
                  baseline
                ),
              ],
            };
          },

          async releaseMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            return false;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.ok(
          error instanceof
            MigrationOrchestratorError
        );

        assert.equal(
          error.code,
          "MIGRATION_LOCK_RELEASE_FAILED"
        );

        return true;
      }
    );

    assert.deepEqual(
      releaseCalls,
      [
        true,
      ]
    );
  }
);

test(
  "migrate preserva erro de execucao quando cleanup e concluido",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baseline =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const future =
      createMigration();

    const executionError =
      new Error(
        "falha de execucao simulada"
      );

    let unlocked = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baseline,
              future,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                true,
              appliedRows: [
                createAppliedRow(
                  baseline
                ),
              ],
            };
          },

          async executeMigrationTransaction(
            receivedClient,
            migration
          ) {
            assert.equal(
              receivedClient,
              client
            );

            assert.equal(
              migration.id,
              future.id
            );

            throw executionError;
          },

          async releaseMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            unlocked = true;

            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error,
          executionError
        );

        return true;
      }
    );

    assert.equal(
      unlocked,
      true
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);
test(
  "discoverMigrationCatalog rejeita baseline canonica ausente",
  async (context) => {
    const directories =
      await createCatalogDirectories(
        context
      );

    await writeRequiredCatalog(
      directories
    );

    await fs.rm(
      path.join(
        directories.versionsDirectory,
        "20260802000000_baseline_current_schema.sql"
      )
    );

    await assert.rejects(
      () =>
        discoverMigrationCatalog(
          directories
        ),
      (error) => {
        assert.equal(
          error.code,
          "MISSING_CANONICAL_BASELINE"
        );

        return true;
      }
    );
  }
);

test(
  "migrate bloqueia drift sem executar migration",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baseline =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const future =
      createMigration();

    let executed = false;
    let unlocked = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baseline,
              future,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                true,
              appliedRows: [
                createAppliedRow(
                  baseline
                ),
                createAppliedRow(
                  future,
                  {
                    checksum:
                      "c".repeat(64),
                  }
                ),
              ],
            };
          },

          async executeMigrationTransaction() {
            executed = true;

            throw new Error(
              "nao deveria executar"
            );
          },

          async releaseMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            unlocked = true;

            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_DRIFT_DETECTED"
        );

        return true;
      }
    );

    assert.equal(
      executed,
      false
    );

    assert.equal(
      unlocked,
      true
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "migrate rejeita lock nao confirmado",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    let readCalled = false;
    let unlockCalled = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [];
          },

          async acquireMigrationLock() {
            return false;
          },

          async readMigrationState() {
            readCalled = true;

            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          async releaseMigrationLock() {
            unlockCalled = true;

            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_LOCK_NOT_CONFIRMED"
        );

        return true;
      }
    );

    assert.equal(
      readCalled,
      false
    );

    assert.equal(
      unlockCalled,
      false
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "migrate libera client quando aquisicao do lock falha",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    const lockError =
      new Error(
        "lock indisponivel"
      );

    lockError.code =
      "MIGRATION_LOCK_UNAVAILABLE";

    let unlockCalled = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [];
          },

          async acquireMigrationLock() {
            throw lockError;
          },

          async releaseMigrationLock() {
            unlockCalled = true;

            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error,
          lockError
        );

        return true;
      }
    );

    assert.equal(
      unlockCalled,
      false
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "migrate destroi client quando rollback falha",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baseline =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const future =
      createMigration();

    const rollbackError =
      new Error(
        "rollback falhou"
      );

    rollbackError.code =
      "MIGRATION_ROLLBACK_FAILED";

    let unlocked = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baseline,
              future,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                true,
              appliedRows: [
                createAppliedRow(
                  baseline
                ),
              ],
            };
          },

          async executeMigrationTransaction(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            throw rollbackError;
          },

          async releaseMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            unlocked = true;

            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error,
          rollbackError
        );

        return true;
      }
    );

    assert.equal(
      unlocked,
      true
    );

    assert.deepEqual(
      releaseCalls,
      [
        true,
      ]
    );
  }
);
test(
  "migrate destroi client quando aquisicao do lock termina com erro inesperado",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    const connectionError =
      new Error(
        "falha de rede simulada"
      );

    connectionError.code =
      "ECONNRESET";

    let readCalled = false;
    let unlockCalled = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        dependencies: {
          async discoverMigrationCatalog() {
            return [];
          },

          async acquireMigrationLock() {
            throw connectionError;
          },

          async readMigrationState() {
            readCalled = true;

            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          async releaseMigrationLock() {
            unlockCalled = true;

            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.migrate(),
      (error) => {
        assert.equal(
          error,
          connectionError
        );

        return true;
      }
    );

    assert.equal(
      readCalled,
      false
    );

    assert.equal(
      unlockCalled,
      false
    );

    assert.deepEqual(
      releaseCalls,
      [
        true,
      ]
    );
  }
);

test(
  "baseline rejeita modo invalido antes de conectar no banco",
  async () => {
    const {
      pool,
    } = createFakePool();

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            throw new Error(
              "nao deveria validar"
            );
          },

          async verifyEmpty() {
            throw new Error(
              "nao deveria validar"
            );
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.baseline({
          mode: "automatic",
        }),
      (error) => {
        assert.equal(
          error.code,
          "INVALID_BASELINE_MODE"
        );

        return true;
      }
    );

    assert.equal(
      pool.connectCalls,
      0
    );
  }
);

test(
  "baseline register-existing valida schema e registra sem executar SQL",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baselineMigration =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const events = [];

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            events.push(
              "verify-existing"
            );

            return {
              baseline: {
                checksum:
                  baselineMigration
                    .checksum,
              },
              schema: {
                semanticChecksum:
                  "c".repeat(64),
              },
            };
          },

          async verifyEmpty() {
            throw new Error(
              "nao deveria verificar vazio"
            );
          },
        },

        dependencies: {
          async discoverMigrationCatalog() {
            events.push(
              "discover"
            );

            return [
              baselineMigration,
            ];
          },

          async acquireMigrationLock(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "lock"
            );

            return true;
          },

          async readMigrationState() {
            events.push(
              "read"
            );

            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          buildMigrationPlan() {
            events.push(
              "plan"
            );

            return {
              hasDrift: false,
              applied: [],
              pending: [
                baselineMigration,
              ],
              baselinePending: [
                baselineMigration,
              ],
              executablePending: [],
              checksumMismatches: [],
              historyMismatches: [],
              missingFiles: [],
            };
          },

          assertMigrationPlanSafe(
            plan,
            options
          ) {
            assert.equal(
              plan.hasDrift,
              false
            );

            assert.equal(
              options
                .allowBaselinePending,
              true
            );

            events.push(
              "safe"
            );
          },

          async registerBaselineTransaction(
            receivedClient,
            migration
          ) {
            assert.equal(
              receivedClient,
              client
            );

            assert.equal(
              migration,
              baselineMigration
            );

            events.push(
              "register"
            );

            return {
              id:
                migration.id,
              filename:
                migration.filename,
              checksum:
                migration.checksum,
              baseline: true,
              executionMs: 0,
            };
          },

          async executeMigrationTransaction() {
            throw new Error(
              "register-existing nao deveria executar SQL"
            );
          },

          async releaseMigrationLock() {
            events.push(
              "unlock"
            );

            return true;
          },
        },
      });

    const result =
      await orchestrator.baseline({
        mode:
          "register-existing",
      });

    assert.deepEqual(
      events,
      [
        "discover",
        "lock",
        "read",
        "plan",
        "safe",
        "verify-existing",
        "register",
        "unlock",
      ]
    );

    assert.equal(
      result.mode,
      "register-existing"
    );

    assert.equal(
      result.baseline
        .executedSql,
      false
    );

    assert.equal(
      result.verification
        .semanticChecksum,
      "c".repeat(64)
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "baseline apply-empty verifica vazio dentro da transacao e destroi sessao",
  async () => {
    const {
      pool,
      client,
      releaseCalls,
    } = createFakePool();

    const baselineMigration =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const events = [];

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            throw new Error(
              "nao deveria validar existente"
            );
          },

          async verifyEmpty(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "verify-empty"
            );

            return {
              baseline: {
                checksum:
                  baselineMigration
                    .checksum,
              },
              schema: {
                empty: true,
              },
            };
          },
        },

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baselineMigration,
            ];
          },

          async acquireMigrationLock() {
            events.push(
              "lock"
            );

            return true;
          },

          async readMigrationState() {
            events.push(
              "read"
            );

            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          buildMigrationPlan() {
            return {
              hasDrift: false,
              applied: [],
              pending: [
                baselineMigration,
              ],
              baselinePending: [
                baselineMigration,
              ],
              executablePending: [],
              checksumMismatches: [],
              historyMismatches: [],
              missingFiles: [],
            };
          },

          assertMigrationPlanSafe() {
            events.push(
              "safe"
            );
          },

          async executeMigrationTransaction(
            receivedClient,
            migration,
            options
          ) {
            assert.equal(
              receivedClient,
              client
            );

            assert.equal(
              migration,
              baselineMigration
            );

            assert.equal(
              options.baseline,
              true
            );

            events.push(
              "begin-execute"
            );

            await options
              .prepareTransaction(
                client
              );

            events.push(
              "sql-baseline"
            );

            return {
              id:
                migration.id,
              filename:
                migration.filename,
              checksum:
                migration.checksum,
              baseline: true,
              executionMs: 18,
            };
          },

          async ensureMetadataTable(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "ensure-metadata"
            );
          },

          async releaseMigrationLock() {
            events.push(
              "unlock"
            );

            return true;
          },
        },
      });

    const result =
      await orchestrator.baseline({
        mode: "apply-empty",
      });

    assert.deepEqual(
      events,
      [
        "lock",
        "read",
        "safe",
        "begin-execute",
        "verify-empty",
        "ensure-metadata",
        "sql-baseline",
        "unlock",
      ]
    );

    assert.equal(
      result.baseline
        .executedSql,
      true
    );

    assert.equal(
      result.verification.empty,
      true
    );

    assert.deepEqual(
      releaseCalls,
      [
        true,
      ]
    );
  }
);

test(
  "baseline rejeita metadata ja inicializada antes do verifier",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    const baselineMigration =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    let verifierCalled = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            verifierCalled = true;
          },

          async verifyEmpty() {
            verifierCalled = true;
          },
        },

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baselineMigration,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                true,
              appliedRows: [],
            };
          },

          async releaseMigrationLock() {
            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.baseline({
          mode:
            "register-existing",
        }),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_BASELINE_ALREADY_INITIALIZED"
        );

        return true;
      }
    );

    assert.equal(
      verifierCalled,
      false
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "baseline rejeita divergencia entre verifier e catalogo",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    const baselineMigration =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    let registered = false;

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            return {
              baseline: {
                checksum:
                  "c".repeat(64),
              },
              schema: {
                semanticChecksum:
                  "d".repeat(64),
              },
            };
          },

          async verifyEmpty() {
            throw new Error(
              "nao deveria validar vazio"
            );
          },
        },

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baselineMigration,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          buildMigrationPlan() {
            return {
              hasDrift: false,
              applied: [],
              pending: [
                baselineMigration,
              ],
              baselinePending: [
                baselineMigration,
              ],
              executablePending: [],
              checksumMismatches: [],
              historyMismatches: [],
              missingFiles: [],
            };
          },

          assertMigrationPlanSafe() {},

          async registerBaselineTransaction() {
            registered = true;
          },

          async releaseMigrationLock() {
            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.baseline({
          mode:
            "register-existing",
        }),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_BASELINE_VERIFICATION_MISMATCH"
        );

        return true;
      }
    );

    assert.equal(
      registered,
      false
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "baseline preserva erro do verifier quando cleanup e seguro",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    const baselineMigration =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const verifierError =
      new Error(
        "schema divergente"
      );

    verifierError.code =
      "BASELINE_SCHEMA_MISMATCH";

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            throw verifierError;
          },

          async verifyEmpty() {
            throw new Error(
              "nao deveria validar vazio"
            );
          },
        },

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baselineMigration,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          buildMigrationPlan() {
            return {
              hasDrift: false,
              applied: [],
              pending: [
                baselineMigration,
              ],
              baselinePending: [
                baselineMigration,
              ],
              executablePending: [],
              checksumMismatches: [],
              historyMismatches: [],
              missingFiles: [],
            };
          },

          assertMigrationPlanSafe() {},

          async releaseMigrationLock() {
            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.baseline({
          mode:
            "register-existing",
        }),
      (error) => {
        assert.equal(
          error,
          verifierError
        );

        return true;
      }
    );

    assert.deepEqual(
      releaseCalls,
      [
        false,
      ]
    );
  }
);

test(
  "baseline apply-empty destroi client quando rollback falha",
  async () => {
    const {
      pool,
      releaseCalls,
    } = createFakePool();

    const baselineMigration =
      createMigration({
        id:
          "20260802000000_baseline_current_schema",
        filename:
          "20260802000000_baseline_current_schema.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline:
          true,
      });

    const rollbackError =
      new Error(
        "rollback baseline falhou"
      );

    rollbackError.code =
      "MIGRATION_ROLLBACK_FAILED";

    const orchestrator =
      createMigrationOrchestrator({
        pool,

        baselineVerifier: {
          async verifyExistingSchema() {
            throw new Error(
              "nao deveria validar existente"
            );
          },

          async verifyEmpty() {
            return {
              baseline: {
                checksum:
                  baselineMigration
                    .checksum,
              },
              schema: {
                empty: true,
              },
            };
          },
        },

        dependencies: {
          async discoverMigrationCatalog() {
            return [
              baselineMigration,
            ];
          },

          async acquireMigrationLock() {
            return true;
          },

          async readMigrationState() {
            return {
              metadataTableExists:
                false,
              appliedRows: [],
            };
          },

          buildMigrationPlan() {
            return {
              hasDrift: false,
              applied: [],
              pending: [
                baselineMigration,
              ],
              baselinePending: [
                baselineMigration,
              ],
              executablePending: [],
              checksumMismatches: [],
              historyMismatches: [],
              missingFiles: [],
            };
          },

          assertMigrationPlanSafe() {},

          async executeMigrationTransaction() {
            throw rollbackError;
          },

          async releaseMigrationLock() {
            return true;
          },
        },
      });

    await assert.rejects(
      () =>
        orchestrator.baseline({
          mode: "apply-empty",
        }),
      (error) => {
        assert.equal(
          error,
          rollbackError
        );

        return true;
      }
    );

    assert.deepEqual(
      releaseCalls,
      [
        true,
      ]
    );
  }
);
