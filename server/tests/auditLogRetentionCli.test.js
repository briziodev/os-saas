const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUDIT_ACTIONS,
} = require("../services/auditLog");

const {
  ACTION_ALL,
  MODE_APPLY,
  MODE_DRY_RUN,
} = require("../services/auditLogRetention");

const {
  AuditLogRetentionCliError,
  parseAuditLogRetentionCliArgs,
  runAuditLogRetentionCli,
} = require("../scripts/auditLogRetention");

test(
  "CLI sem argumentos retorna help e não assume política de retenção",
  () => {
    const parsed =
      parseAuditLogRetentionCliArgs([]);

    assert.equal(
      parsed.help,
      true
    );

    assert.equal(
      parsed.retentionDays,
      undefined
    );
  }
);

test(
  "CLI DRY_RUN exige retention-days explícito e usa ALL como preview padrão",
  () => {
    const parsed =
      parseAuditLogRetentionCliArgs([
        "--retention-days",
        "365",
      ]);

    assert.equal(
      parsed.help,
      false
    );

    assert.equal(
      parsed.mode,
      MODE_DRY_RUN
    );

    assert.equal(
      parsed.retentionDays,
      365
    );

    assert.equal(
      parsed.action,
      ACTION_ALL
    );
  }
);

test(
  "CLI APPLY rejeita action implícito",
  () => {
    assert.throws(
      () =>
        parseAuditLogRetentionCliArgs([
          "--retention-days",
          "365",
          "--mode",
          "APPLY",
          "--confirm",
          "PURGE_AUDIT_LOGS_365_DAYS_ALL",
        ]),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionCliError
        );

        assert.equal(
          error.code,
          "APPLY_ACTION_REQUIRED"
        );

        return true;
      }
    );
  }
);

test(
  "CLI APPLY aceita action e confirmação explícitas",
  () => {
    const parsed =
      parseAuditLogRetentionCliArgs([
        "--retention-days",
        "365",
        "--mode",
        "APPLY",
        "--action",
        AUDIT_ACTIONS.OS_DELETED,
        "--confirm",
        "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
        "--batch-size",
        "250",
        "--max-delete",
        "5000",
      ]);

    assert.equal(
      parsed.mode,
      MODE_APPLY
    );

    assert.equal(
      parsed.retentionDays,
      365
    );

    assert.equal(
      parsed.action,
      AUDIT_ACTIONS.OS_DELETED
    );

    assert.equal(
      parsed.confirmation,
      "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED"
    );

    assert.equal(
      parsed.batchSize,
      250
    );

    assert.equal(
      parsed.maxDeletePerRun,
      5000
    );
  }
);

test(
  "CLI rejeita argumento desconhecido",
  () => {
    assert.throws(
      () =>
        parseAuditLogRetentionCliArgs([
          "--retention-days",
          "365",
          "--destruir-tudo",
        ]),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionCliError
        );

        assert.equal(
          error.code,
          "UNKNOWN_ARGUMENT"
        );

        return true;
      }
    );
  }
);

test(
  "CLI help não cria pool nem executa retenção",
  async () => {
    let createPoolCalls = 0;
    let retentionCalls = 0;

    const result =
      await runAuditLogRetentionCli({
        argv: [],
        createPool: async () => {
          createPoolCalls += 1;

          throw new Error(
            "Pool não deveria ser criado."
          );
        },
        runRetention: async () => {
          retentionCalls += 1;

          throw new Error(
            "Retenção não deveria executar."
          );
        },
      });

    assert.equal(
      result.help,
      true
    );

    assert.equal(
      createPoolCalls,
      0
    );

    assert.equal(
      retentionCalls,
      0
    );
  }
);

test(
  "CLI executa DRY_RUN e encerra pool",
  async () => {
    let endCalls = 0;
    let receivedOptions = null;

    const fakePool = {
      async end() {
        endCalls += 1;
      },
    };

    const result =
      await runAuditLogRetentionCli({
        argv: [
          "--retention-days",
          "365",
          "--action",
          AUDIT_ACTIONS.OS_DELETED,
        ],

        createPool: async () =>
          fakePool,

        runRetention:
          async (
            receivedPool,
            options
          ) => {
            assert.equal(
              receivedPool,
              fakePool
            );

            receivedOptions =
              options;

            return {
              mode: MODE_DRY_RUN,
              eligibleCount: 10,
              deletedCount: 0,
            };
          },
      });

    assert.equal(
      result.mode,
      MODE_DRY_RUN
    );

    assert.equal(
      receivedOptions.retentionDays,
      365
    );

    assert.equal(
      receivedOptions.action,
      AUDIT_ACTIONS.OS_DELETED
    );

    assert.equal(
      endCalls,
      1
    );
  }
);

test(
  "CLI encerra pool mesmo quando retenção falha",
  async () => {
    let endCalls = 0;

    const operationalFailure =
      new Error(
        "Falha operacional artificial."
      );

    const fakePool = {
      async end() {
        endCalls += 1;
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetentionCli({
          argv: [
            "--retention-days",
            "365",
          ],

          createPool: async () =>
            fakePool,

          runRetention: async () => {
            throw operationalFailure;
          },
        }),
      (error) => {
        assert.equal(
          error,
          operationalFailure
        );

        return true;
      }
    );

    assert.equal(
      endCalls,
      1
    );
  }
);