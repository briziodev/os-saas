const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MigrationRunnerError,
  assertMigrationPlanSafe,
  executeMigrationTransaction,
  normalizeMigrationForExecution,
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
