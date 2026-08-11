const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MigrationCliError,
  parseMigrationCliArgs,
  runMigrationCli,
  serializeCliError,
} = require(
  "../database/migrationCli"
);

function createFakePool(
  options = {}
) {
  const endCalls = [];

  const pool = {
    async connect() {
      return {
        query: async () => ({
          rows: [],
        }),
        release() {},
      };
    },

    async end() {
      endCalls.push(
        true
      );

      if (
        options.endError
      ) {
        throw options.endError;
      }
    },
  };

  return {
    pool,
    endCalls,
  };
}

test(
  "parseMigrationCliArgs retorna help sem argumentos",
  () => {
    assert.deepEqual(
      parseMigrationCliArgs(
        []
      ),
      {
        action: "help",
      }
    );
  }
);

test(
  "parseMigrationCliArgs aceita status sem opcoes",
  () => {
    assert.deepEqual(
      parseMigrationCliArgs([
        "status",
      ]),
      {
        action: "status",
      }
    );

    assert.throws(
      () =>
        parseMigrationCliArgs([
          "status",
          "--wait-for-lock",
        ]),
      (error) => {
        assert.equal(
          error.code,
          "INVALID_CLI_ARGUMENTS"
        );

        return true;
      }
    );
  }
);

test(
  "parseMigrationCliArgs aceita migrate com wait explicito",
  () => {
    assert.deepEqual(
      parseMigrationCliArgs([
        "migrate",
        "--wait-for-lock",
      ]),
      {
        action: "migrate",
        waitForLock: true,
      }
    );
  }
);

test(
  "parseMigrationCliArgs exige confirmacao explicita da baseline",
  () => {
    assert.throws(
      () =>
        parseMigrationCliArgs([
          "baseline",
          "register-existing",
        ]),
      (error) => {
        assert.equal(
          error.code,
          "BASELINE_CONFIRMATION_REQUIRED"
        );

        return true;
      }
    );
  }
);

test(
  "parseMigrationCliArgs rejeita confirmacao de modo diferente",
  () => {
    assert.throws(
      () =>
        parseMigrationCliArgs([
          "baseline",
          "apply-empty",
          "--confirm-baseline=register-existing",
        ]),
      (error) => {
        assert.equal(
          error.code,
          "BASELINE_CONFIRMATION_REQUIRED"
        );

        return true;
      }
    );
  }
);

test(
  "parseMigrationCliArgs aceita register-existing confirmado",
  () => {
    assert.deepEqual(
      parseMigrationCliArgs([
        "baseline",
        "register-existing",
        "--confirm-baseline=register-existing",
        "--wait-for-lock",
      ]),
      {
        action: "baseline",
        mode:
          "register-existing",
        waitForLock: true,
      }
    );
  }
);

test(
  "parseMigrationCliArgs rejeita comando desconhecido",
  () => {
    assert.throws(
      () =>
        parseMigrationCliArgs([
          "automatic",
        ]),
      (error) => {
        assert.equal(
          error.code,
          "UNKNOWN_CLI_COMMAND"
        );

        return true;
      }
    );
  }
);

test(
  "runMigrationCli help nao cria pool",
  async () => {
    let poolCreated = false;

    const result =
      await runMigrationCli(
        [
          "--help",
        ],
        {
          getPool() {
            poolCreated =
              true;

            throw new Error(
              "nao deveria criar pool"
            );
          },
        }
      );

    assert.equal(
      result.ok,
      true
    );

    assert.equal(
      result.command.action,
      "help"
    );

    assert.equal(
      poolCreated,
      false
    );

    assert.match(
      result.usage,
      /register-existing/
    );
  }
);

test(
  "runMigrationCli status chama somente status e encerra pool",
  async () => {
    const {
      pool,
      endCalls,
    } = createFakePool();

    let statusCalls = 0;

    const result =
      await runMigrationCli(
        [
          "status",
        ],
        {
          getPool() {
            return pool;
          },

          createOrchestrator(
            options
          ) {
            assert.equal(
              options.pool,
              pool
            );

            return {
              async status() {
                statusCalls += 1;

                return {
                  hasDrift:
                    false,
                };
              },
            };
          },
        }
      );

    assert.equal(
      statusCalls,
      1
    );

    assert.deepEqual(
      endCalls,
      [
        true,
      ]
    );

    assert.deepEqual(
      result,
      {
        ok: true,
        command: {
          action: "status",
        },
        result: {
          hasDrift:
            false,
        },
      }
    );
  }
);

test(
  "runMigrationCli migrate propaga waitForLock e encerra pool",
  async () => {
    const {
      pool,
      endCalls,
    } = createFakePool();

    let receivedOptions = null;

    const result =
      await runMigrationCli(
        [
          "migrate",
          "--wait-for-lock",
        ],
        {
          getPool() {
            return pool;
          },

          createOrchestrator() {
            return {
              async migrate(
                options
              ) {
                receivedOptions =
                  options;

                return {
                  executed: [],
                };
              },
            };
          },
        }
      );

    assert.deepEqual(
      receivedOptions,
      {
        waitForLock: true,
      }
    );

    assert.deepEqual(
      endCalls,
      [
        true,
      ]
    );

    assert.equal(
      result.ok,
      true
    );
  }
);

test(
  "runMigrationCli register-existing compoe provider verifier e orchestrator",
  async () => {
    const {
      pool,
      endCalls,
    } = createFakePool();

    const events = [];
    const dumpSchema =
      async () =>
        "schema";

    const verifier = {
      verifyExistingSchema() {},
      verifyEmpty() {},
    };

    const result =
      await runMigrationCli(
        [
          "baseline",
          "register-existing",
          "--confirm-baseline=register-existing",
        ],
        {
          env: {
            DATABASE_URL:
              "postgresql://example",
          },

          getPool() {
            return pool;
          },

          createDumpProvider(
            options
          ) {
            events.push(
              "dump-provider"
            );

            assert.equal(
              options.env
                .DATABASE_URL,
              "postgresql://example"
            );

            return dumpSchema;
          },

          createVerifier(
            options
          ) {
            events.push(
              "verifier"
            );

            assert.equal(
              options.dumpSchema,
              dumpSchema
            );

            return verifier;
          },

          createOrchestrator(
            options
          ) {
            events.push(
              "orchestrator"
            );

            assert.equal(
              options.pool,
              pool
            );

            assert.equal(
              options
                .baselineVerifier,
              verifier
            );

            return {
              async baseline(
                options
              ) {
                events.push(
                  "baseline"
                );

                assert.deepEqual(
                  options,
                  {
                    mode:
                      "register-existing",
                    waitForLock:
                      false,
                  }
                );

                return {
                  mode:
                    options.mode,
                };
              },
            };
          },
        }
      );

    assert.deepEqual(
      events,
      [
        "dump-provider",
        "verifier",
        "orchestrator",
        "baseline",
      ]
    );

    assert.deepEqual(
      endCalls,
      [
        true,
      ]
    );

    assert.equal(
      result.result.mode,
      "register-existing"
    );
  }
);

test(
  "runMigrationCli apply-empty nao cria provider de pg_dump",
  async () => {
    const {
      pool,
      endCalls,
    } = createFakePool();

    let dumpProviderCalled =
      false;

    let receivedOptions = null;

    const result =
      await runMigrationCli(
        [
          "baseline",
          "apply-empty",
          "--confirm-baseline=apply-empty",
        ],
        {
          getPool() {
            return pool;
          },

          createDumpProvider() {
            dumpProviderCalled =
              true;

            throw new Error(
              "nao deveria criar provider"
            );
          },

          createOrchestrator() {
            return {
              async baseline(
                options
              ) {
                receivedOptions =
                  options;

                return {
                  mode:
                    options.mode,
                };
              },
            };
          },
        }
      );

    assert.equal(
      dumpProviderCalled,
      false
    );

    assert.deepEqual(
      receivedOptions,
      {
        mode:
          "apply-empty",
        waitForLock:
          false,
      }
    );

    assert.deepEqual(
      endCalls,
      [
        true,
      ]
    );

    assert.equal(
      result.ok,
      true
    );
  }
);

test(
  "runMigrationCli preserva erro operacional quando pool fecha corretamente",
  async () => {
    const {
      pool,
      endCalls,
    } = createFakePool();

    const operationError =
      new Error(
        "drift"
      );

    operationError.name =
      "MigrationOrchestratorError";

    operationError.code =
      "MIGRATION_DRIFT_DETECTED";

    operationError.details =
      {
        filename:
          "example.sql",
      };

    await assert.rejects(
      () =>
        runMigrationCli(
          [
            "status",
          ],
          {
            getPool() {
              return pool;
            },

            createOrchestrator() {
              return {
                async status() {
                  throw operationError;
                },
              };
            },
          }
        ),
      (error) => {
        assert.equal(
          error,
          operationError
        );

        return true;
      }
    );

    assert.deepEqual(
      endCalls,
      [
        true,
      ]
    );
  }
);

test(
  "runMigrationCli reporta falha segura ao encerrar pool",
  async () => {
    const closeError =
      new Error(
        "close failed secret-value"
      );

    closeError.code =
      "POOL_CLOSE_FAILED";

    const {
      pool,
    } = createFakePool({
      endError:
        closeError,
    });

    await assert.rejects(
      () =>
        runMigrationCli(
          [
            "status",
          ],
          {
            getPool() {
              return pool;
            },

            createOrchestrator() {
              return {
                async status() {
                  return {
                    hasDrift:
                      false,
                  };
                },
              };
            },
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationCliError
        );

        assert.equal(
          error.code,
          "MIGRATION_CLI_POOL_CLOSE_FAILED"
        );

        const visible =
          JSON.stringify(
            serializeCliError(
              error
            )
          );

        assert.equal(
          visible.includes(
            "secret-value"
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "serializeCliError oculta erro inesperado",
  () => {
    const error =
      new Error(
        "DATABASE_URL=postgresql://user:password@example"
      );

    const result =
      serializeCliError(
        error
      );

    assert.deepEqual(
      result,
      {
        ok: false,
        error: {
          name:
            "MigrationCliError",
          code:
            "MIGRATION_CLI_UNEXPECTED_ERROR",
          message:
            "Falha inesperada na operação de migrations.",
        },
      }
    );

    assert.equal(
      JSON.stringify(
        result
      ).includes(
        "password"
      ),
      false
    );
  }
);
