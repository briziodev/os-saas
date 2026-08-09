const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MigrationRunnerError,
  assertMigrationPlanSafe,
  executeMigrationTransaction,
  normalizeBaselineForRegistration,
  normalizeMigrationForExecution,
  registerBaselineTransaction,
} = require(
  "../database/migrationRunner"
);

function createMigration(
  overrides = {}
) {
  return {
    id:
      "20260804190000_example",
    filename:
      "20260804190000_example.sql",
    checksum:
      "a".repeat(64),
    sql:
      "CREATE TABLE example (id integer);",
    containsTransactionControl:
      false,
    ...overrides,
  };
}

function createFakeClient(handler) {
  const calls = [];

  return {
    calls,

    async query(text, values) {
      const normalizedText =
        String(text).trim();

      const call = {
        text: normalizedText,
        values,
      };

      calls.push(call);

      if (handler) {
        return handler(
          call,
          calls
        );
      }

      return {
        rows: [],
      };
    },
  };
}

test(
  "normalizeMigrationForExecution aceita migration válida",
  () => {
    const migration =
      normalizeMigrationForExecution(
        createMigration()
      );

    assert.equal(
      migration.id,
      "20260804190000_example"
    );

    assert.equal(
      migration.checksum,
      "a".repeat(64)
    );

    assert.match(
      migration.sql,
      /CREATE TABLE/
    );
  }
);

test(
  "normalizeMigrationForExecution rejeita controle transacional",
  () => {
    assert.throws(
      () =>
        normalizeMigrationForExecution(
          createMigration({
            containsTransactionControl:
              true,
          })
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationRunnerError
        );

        assert.equal(
          error.code,
          "MIGRATION_TRANSACTION_CONTROL_FORBIDDEN"
        );

        return true;
      }
    );
  }
);

test(
  "normalizeMigrationForExecution detecta controle no SQL mesmo sem flag",
  () => {
    assert.throws(
      () =>
        normalizeMigrationForExecution(
          createMigration({
            sql: [
              "BEGIN;",
              "CREATE TABLE example (id integer);",
              "COMMIT;",
            ].join("\n"),
            containsTransactionControl:
              false,
          })
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationRunnerError
        );

        assert.equal(
          error.code,
          "MIGRATION_TRANSACTION_CONTROL_FORBIDDEN"
        );

        return true;
      }
    );
  }
);

test(
  "assertMigrationPlanSafe aprova plano sem drift",
  () => {
    assert.equal(
      assertMigrationPlanSafe({
        hasDrift: false,
        checksumMismatches: [],
        missingFiles: [],
        baselinePending: [],
        executablePending: [
          createMigration(),
        ],
      }),
      true
    );
  }
);

test(
  "assertMigrationPlanSafe rejeita drift",
  () => {
    assert.throws(
      () =>
        assertMigrationPlanSafe({
          hasDrift: true,
          checksumMismatches: [
            {
              id:
                "20260804190000_example",
            },
          ],
          missingFiles: [],
          baselinePending: [],
          executablePending: [],
        }),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_DRIFT_DETECTED"
        );

        return true;
      }
    );
  }
);

test(
  "assertMigrationPlanSafe exige baseline explícita",
  () => {
    assert.throws(
      () =>
        assertMigrationPlanSafe({
          hasDrift: false,
          checksumMismatches: [],
          missingFiles: [],
          baselinePending: [
            createMigration(),
          ],
          executablePending: [],
        }),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_BASELINE_REQUIRED"
        );

        return true;
      }
    );

    assert.equal(
      assertMigrationPlanSafe(
        {
          hasDrift: false,
          checksumMismatches: [],
          missingFiles: [],
          baselinePending: [
            createMigration(),
          ],
          executablePending: [],
        },
        {
          allowBaselinePending:
            true,
        }
      ),
      true
    );
  }
);

test(
  "assertMigrationPlanSafe rejeita baseline transacional mesmo quando autorizada",
  () => {
    assert.throws(
      () =>
        assertMigrationPlanSafe(
          {
            hasDrift: false,
            checksumMismatches: [],
            missingFiles: [],
            baselinePending: [
              createMigration({
                sql: [
                  "BEGIN;",
                  "CREATE TABLE example (id integer);",
                  "COMMIT;",
                ].join("\n"),
                containsTransactionControl:
                  false,
              }),
            ],
            executablePending: [],
          },
          {
            allowBaselinePending:
              true,
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationRunnerError
        );

        assert.equal(
          error.code,
          "MIGRATION_TRANSACTION_CONTROL_FORBIDDEN"
        );

        return true;
      }
    );
  }
);

test(
  "assertMigrationPlanSafe rejeita migration transacional pendente",
  () => {
    assert.throws(
      () =>
        assertMigrationPlanSafe({
          hasDrift: false,
          checksumMismatches: [],
          missingFiles: [],
          baselinePending: [],
          executablePending: [
            createMigration({
              containsTransactionControl:
                true,
            }),
          ],
        }),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_TRANSACTION_CONTROL_FORBIDDEN"
        );

        return true;
      }
    );
  }
);

test(
  "executeMigrationTransaction executa SQL e registro na mesma transação",
  async () => {
    const events = [];

    const client =
      createFakeClient(
        async (call) => {
          events.push(call.text);

          return {
            rows: [],
          };
        }
      );

    const times = [
      100,
      125,
    ];

    const result =
      await executeMigrationTransaction(
        client,
        createMigration(),
        {
          now() {
            return times.shift();
          },

          async recordMigration(
            receivedClient,
            record
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "RECORD_MIGRATION"
            );

            return {
              ...record,
              applied_at:
                new Date(
                  "2026-08-04T23:00:00Z"
                ),
            };
          },
        }
      );

    assert.deepEqual(
      events,
      [
        "BEGIN",
        "CREATE TABLE example (id integer);",
        "RECORD_MIGRATION",
        "COMMIT",
      ]
    );

    assert.equal(
      result.executionMs,
      25
    );

    assert.equal(
      result.baseline,
      false
    );
  }
);

test(
  "executeMigrationTransaction executa rollback quando o SQL falha",
  async () => {
    const client =
      createFakeClient(
        async (call) => {
          if (
            call.text.startsWith(
              "CREATE TABLE"
            )
          ) {
            throw new Error(
              "erro SQL simulado"
            );
          }

          return {
            rows: [],
          };
        }
      );

    await assert.rejects(
      () =>
        executeMigrationTransaction(
          client,
          createMigration(),
          {
            now: () => 100,
            recordMigration:
              async () => {
                throw new Error(
                  "não deveria registrar"
                );
              },
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_EXECUTION_FAILED"
        );

        return true;
      }
    );

    assert.deepEqual(
      client.calls.map(
        (call) => call.text
      ),
      [
        "BEGIN",
        "CREATE TABLE example (id integer);",
        "ROLLBACK",
      ]
    );
  }
);

test(
  "executeMigrationTransaction executa rollback quando o registro falha",
  async () => {
    const client =
      createFakeClient();

    await assert.rejects(
      () =>
        executeMigrationTransaction(
          client,
          createMigration(),
          {
            now: (() => {
              const times = [
                10,
                20,
              ];

              return () =>
                times.shift();
            })(),

            recordMigration:
              async () => {
                throw new Error(
                  "registro recusado"
                );
              },
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_EXECUTION_FAILED"
        );

        return true;
      }
    );

    assert.deepEqual(
      client.calls.map(
        (call) => call.text
      ),
      [
        "BEGIN",
        "CREATE TABLE example (id integer);",
        "ROLLBACK",
      ]
    );
  }
);

test(
  "executeMigrationTransaction reporta falha do rollback",
  async () => {
    const client =
      createFakeClient(
        async (call) => {
          if (
            call.text.startsWith(
              "CREATE TABLE"
            )
          ) {
            throw new Error(
              "falha original"
            );
          }

          if (
            call.text ===
            "ROLLBACK"
          ) {
            throw new Error(
              "falha no rollback"
            );
          }

          return {
            rows: [],
          };
        }
      );

    await assert.rejects(
      () =>
        executeMigrationTransaction(
          client,
          createMigration(),
          {
            now: () => 100,
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_ROLLBACK_FAILED"
        );

        assert.equal(
          error.details
            .originalError,
          "falha original"
        );

        assert.equal(
          error.details
            .rollbackError,
          "falha no rollback"
        );

        return true;
      }
    );
  }
);

test(
  "assertMigrationPlanSafe rejeita divergencia semantica do historico",
  () => {
    assert.throws(
      () =>
        assertMigrationPlanSafe({
          hasDrift: false,
          checksumMismatches: [],
          historyMismatches: [
            {
              id:
                "20260804190000_example",
              fields: [
                "filename",
              ],
            },
          ],
          missingFiles: [],
          baselinePending: [],
          executablePending: [],
        }),
      (error) => {
        assert.ok(
          error instanceof
            MigrationRunnerError
        );

        assert.equal(
          error.code,
          "MIGRATION_DRIFT_DETECTED"
        );

        assert.deepEqual(
          error.details
            .historyMismatches,
          [
            {
              id:
                "20260804190000_example",
              fields: [
                "filename",
              ],
            },
          ]
        );

        return true;
      }
    );
  }
);

test(
  "normalizeBaselineForRegistration exige classificacao historica explicita",
  () => {
    assert.throws(
      () =>
        normalizeBaselineForRegistration(
          createMigration()
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationRunnerError
        );

        assert.equal(
          error.code,
          "MIGRATION_BASELINE_CLASSIFICATION_REQUIRED"
        );

        return true;
      }
    );

    const baseline =
      normalizeBaselineForRegistration(
        createMigration({
          historicalBaseline:
            true,
        })
      );

    assert.equal(
      baseline.historicalBaseline,
      true
    );
  }
);

test(
  "executeMigrationTransaction prepara metadata e aplica baseline na mesma transacao",
  async () => {
    const events = [];

    const client =
      createFakeClient(
        async (call) => {
          events.push(call.text);

          return {
            rows: [],
          };
        }
      );

    const times = [
      50,
      75,
    ];

    await executeMigrationTransaction(
      client,
      createMigration({
        historicalBaseline:
          true,
      }),
      {
        baseline: true,

        async prepareTransaction(
          receivedClient,
          migration
        ) {
          assert.equal(
            receivedClient,
            client
          );

          assert.equal(
            migration.id,
            "20260804190000_example"
          );

          events.push(
            "PREPARE_TRANSACTION"
          );
        },

        now() {
          return times.shift();
        },

        async recordMigration(
          receivedClient,
          record
        ) {
          assert.equal(
            receivedClient,
            client
          );

          assert.equal(
            record.baseline,
            true
          );

          events.push(
            "RECORD_MIGRATION"
          );

          return {};
        },
      }
    );

    assert.deepEqual(
      events,
      [
        "BEGIN",
        "PREPARE_TRANSACTION",
        "CREATE TABLE example (id integer);",
        "RECORD_MIGRATION",
        "COMMIT",
      ]
    );
  }
);

test(
  "executeMigrationTransaction faz rollback quando preparacao da baseline falha",
  async () => {
    const client =
      createFakeClient();

    await assert.rejects(
      () =>
        executeMigrationTransaction(
          client,
          createMigration({
            historicalBaseline:
              true,
          }),
          {
            baseline: true,

            async prepareTransaction() {
              throw new Error(
                "preparacao recusada"
              );
            },

            async recordMigration() {
              throw new Error(
                "nao deveria registrar"
              );
            },
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_EXECUTION_FAILED"
        );

        return true;
      }
    );

    assert.deepEqual(
      client.calls.map(
        (call) => call.text
      ),
      [
        "BEGIN",
        "ROLLBACK",
      ]
    );
  }
);

test(
  "executeMigrationTransaction exige historicalBaseline para baseline=true",
  async () => {
    const client =
      createFakeClient();

    await assert.rejects(
      () =>
        executeMigrationTransaction(
          client,
          createMigration(),
          {
            baseline: true,
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_BASELINE_CLASSIFICATION_REQUIRED"
        );

        return true;
      }
    );

    assert.deepEqual(
      client.calls,
      []
    );
  }
);

test(
  "registerBaselineTransaction registra baseline sem executar SQL historico",
  async () => {
    const events = [];

    const client =
      createFakeClient(
        async (call) => {
          events.push(call.text);

          return {
            rows: [],
          };
        }
      );

    const result =
      await registerBaselineTransaction(
        client,
        createMigration({
          historicalBaseline:
            true,
        }),
        {
          async ensureMetadataTable(
            receivedClient
          ) {
            assert.equal(
              receivedClient,
              client
            );

            events.push(
              "ENSURE_METADATA"
            );
          },

          async recordMigration(
            receivedClient,
            record
          ) {
            assert.equal(
              receivedClient,
              client
            );

            assert.deepEqual(
              record,
              {
                id:
                  "20260804190000_example",
                filename:
                  "20260804190000_example.sql",
                checksum:
                  "a".repeat(64),
                baseline: true,
                executionMs: 0,
              }
            );

            events.push(
              "RECORD_BASELINE"
            );

            return {
              ...record,
              applied_at:
                new Date(
                  "2026-08-09T16:00:00Z"
                ),
            };
          },
        }
      );

    assert.deepEqual(
      events,
      [
        "BEGIN",
        "ENSURE_METADATA",
        "RECORD_BASELINE",
        "COMMIT",
      ]
    );

    assert.equal(
      result.baseline,
      true
    );

    assert.equal(
      result.executionMs,
      0
    );

    assert.equal(
      client.calls.some(
        (call) =>
          call.text.startsWith(
            "CREATE TABLE example"
          )
      ),
      false
    );
  }
);

test(
  "registerBaselineTransaction faz rollback quando preparacao da metadata falha",
  async () => {
    const client =
      createFakeClient();

    await assert.rejects(
      () =>
        registerBaselineTransaction(
          client,
          createMigration({
            historicalBaseline:
              true,
          }),
          {
            async ensureMetadataTable() {
              throw new Error(
                "metadata recusada"
              );
            },

            async recordMigration() {
              throw new Error(
                "nao deveria registrar"
              );
            },
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_BASELINE_REGISTRATION_FAILED"
        );

        return true;
      }
    );

    assert.deepEqual(
      client.calls.map(
        (call) => call.text
      ),
      [
        "BEGIN",
        "ROLLBACK",
      ]
    );
  }
);

test(
  "registerBaselineTransaction reporta falha do rollback",
  async () => {
    const client =
      createFakeClient(
        async (call) => {
          if (
            call.text ===
            "ROLLBACK"
          ) {
            throw new Error(
              "rollback baseline falhou"
            );
          }

          return {
            rows: [],
          };
        }
      );

    await assert.rejects(
      () =>
        registerBaselineTransaction(
          client,
          createMigration({
            historicalBaseline:
              true,
          }),
          {
            async ensureMetadataTable() {
              throw new Error(
                "falha original baseline"
              );
            },
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "MIGRATION_ROLLBACK_FAILED"
        );

        assert.equal(
          error.details
            .originalError,
          "falha original baseline"
        );

        assert.equal(
          error.details
            .rollbackError,
          "rollback baseline falhou"
        );

        return true;
      }
    );
  }
);
