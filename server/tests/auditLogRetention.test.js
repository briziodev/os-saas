const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUDIT_ACTIONS,
} = require("../services/auditLog");

const {
  AuditLogRetentionError,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_DELETE_PER_RUN,
  MODE_APPLY,
  MODE_DRY_RUN,
  ACTION_ALL,
  normalizeRetentionDays,
  normalizeAuditAction,
  normalizeRetentionMode,
  buildApplyConfirmation,
  buildRetentionPlan,
  runAuditLogRetention,
} = require("../services/auditLogRetention");

test(
  "normalizeRetentionDays aceita inteiro positivo",
  () => {
    assert.equal(
      normalizeRetentionDays("365"),
      365
    );

    assert.equal(
      normalizeRetentionDays(30),
      30
    );
  }
);

test(
  "normalizeRetentionDays rejeita valores inseguros",
  () => {
    for (const value of [
      undefined,
      null,
      "",
      "0",
      0,
      "-1",
      "30.5",
      "abc",
    ]) {
      assert.throws(
        () => normalizeRetentionDays(value),
        (error) => {
          assert.ok(
            error instanceof AuditLogRetentionError
          );

          assert.equal(
            error.code,
            "INVALID_RETENTION_DAYS"
          );

          return true;
        }
      );
    }
  }
);

test(
  "normalizeAuditAction aceita ações conhecidas e ALL",
  () => {
    for (const action of [
      ...Object.values(AUDIT_ACTIONS),
      ACTION_ALL,
    ]) {
      assert.equal(
        normalizeAuditAction(action),
        action
      );
    }
  }
);

test(
  "normalizeAuditAction rejeita ação desconhecida",
  () => {
    assert.throws(
      () =>
        normalizeAuditAction(
          "UNKNOWN_ACTION"
        ),
      (error) => {
        assert.ok(
          error instanceof AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "INVALID_AUDIT_ACTION"
        );

        return true;
      }
    );
  }
);

test(
  "normalizeRetentionMode usa DRY_RUN por padrão",
  () => {
    assert.equal(
      normalizeRetentionMode(),
      MODE_DRY_RUN
    );

    assert.equal(
      normalizeRetentionMode("dry_run"),
      MODE_DRY_RUN
    );

    assert.equal(
      normalizeRetentionMode("apply"),
      MODE_APPLY
    );
  }
);

test(
  "buildApplyConfirmation vincula confirmação a dias e ação",
  () => {
    assert.equal(
      buildApplyConfirmation({
        retentionDays: 365,
        action: AUDIT_ACTIONS.OS_DELETED,
      }),
      "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED"
    );

    assert.equal(
      buildApplyConfirmation({
        retentionDays: 365,
        action: ACTION_ALL,
      }),
      "PURGE_AUDIT_LOGS_365_DAYS_ALL"
    );
  }
);

test(
  "buildRetentionPlan congela cutoff e limites da execução",
  () => {
    const now =
      new Date(
        "2026-09-05T12:00:00.000Z"
      );

    const plan =
      buildRetentionPlan({
        retentionDays: 365,
        action:
          AUDIT_ACTIONS.OS_DELETED,
        mode: MODE_DRY_RUN,
        now,
      });

    assert.equal(
      plan.mode,
      MODE_DRY_RUN
    );

    assert.equal(
      plan.retentionDays,
      365
    );

    assert.equal(
      plan.action,
      AUDIT_ACTIONS.OS_DELETED
    );

    assert.equal(
      plan.cutoff.toISOString(),
      "2025-09-05T12:00:00.000Z"
    );

    assert.equal(
      plan.batchSize,
      DEFAULT_BATCH_SIZE
    );

    assert.equal(
      plan.maxDeletePerRun,
      DEFAULT_MAX_DELETE_PER_RUN
    );
  }
);

test(
  "DRY_RUN conta elegíveis sem executar DELETE",
  async () => {
    const queries = [];

    const fakeDb = {
      async query(sql, values = []) {
        queries.push({
          sql: String(sql),
          values,
        });

        if (
          /GROUP BY\s+action/i.test(
            String(sql)
          )
        ) {
          return {
            rows: [
              {
                action:
                  AUDIT_ACTIONS.OS_DELETED,
                eligible_count: "12",
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            String(sql)
          )
        ) {
          return {
            rows: [
              {
                eligible_count: "12",
              },
            ],
          };
        }

        throw new Error(
          `SQL inesperado: ${sql}`
        );
      },
    };

    const result =
      await runAuditLogRetention(
        fakeDb,
        {
          retentionDays: 365,
          action:
            AUDIT_ACTIONS.OS_DELETED,
          mode: MODE_DRY_RUN,
          now:
            new Date(
              "2026-09-05T12:00:00.000Z"
            ),
        }
      );

    assert.equal(
      result.mode,
      MODE_DRY_RUN
    );

    assert.equal(
      result.eligibleCount,
      12
    );

    assert.equal(
      result.deletedCount,
      0
    );

    assert.equal(
      result.groups.length,
      1
    );

    assert.equal(
      queries.some(
        ({ sql }) =>
          /\bDELETE\b/i.test(sql)
      ),
      false
    );

    assert.equal(
      queries.some(
        ({ sql }) =>
          /\bBEGIN\b/i.test(sql)
      ),
      false
    );
  }
);

test(
  "APPLY rejeita confirmação incorreta antes de consultar banco",
  async () => {
    let queryCount = 0;

    const fakeDb = {
      async query() {
        queryCount += 1;

        throw new Error(
          "Banco não deveria ser consultado."
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "CONFIRMACAO_ERRADA",
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "INVALID_APPLY_CONFIRMATION"
        );

        return true;
      }
    );

    assert.equal(queryCount, 0);
  }
);

test(
  "APPLY bloqueia volume acima do limite e faz rollback",
  async () => {
    const commands = [];

    const fakeDb = {
      async query(sql) {
        const text =
          String(sql).trim();

        commands.push(text);

        if (text === "BEGIN") {
          return { rows: [] };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(text)
        ) {
          return {
            rows: [
              {
                eligible_count: "5001",
              },
            ],
          };
        }

        if (text === "ROLLBACK") {
          return { rows: [] };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            maxDeletePerRun: 5000,
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "AUDIT_RETENTION_DELETE_LIMIT_EXCEEDED"
        );

        return true;
      }
    );

    assert.ok(
      commands.includes("ROLLBACK")
    );

    assert.equal(
      commands.some(
        (sql) =>
          /\bDELETE\b/i.test(sql)
      ),
      false
    );
  }
);

test(
  "APPLY remove elegíveis em batches, valida resultado e faz COMMIT",
  async () => {
    const commands = [];
    let countCalls = 0;
    let deleteCalls = 0;

    const fakeDb = {
      async query(sql, values = []) {
        const text =
          String(sql).trim();

        commands.push({
          sql: text,
          values,
        });

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                action:
                  AUDIT_ACTIONS.OS_DELETED,
                eligible_count: "3",
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          countCalls += 1;

          return {
            rows: [
              {
                eligible_count:
                  countCalls === 1
                    ? "3"
                    : "0",
              },
            ],
          };
        }

        if (
          /\bDELETE\s+FROM\s+audit_logs\b/i.test(
            text
          )
        ) {
          deleteCalls += 1;

          if (deleteCalls === 1) {
            return {
              rowCount: 2,
              rows: [
                { id: 101 },
                { id: 102 },
              ],
            };
          }

          if (deleteCalls === 2) {
            return {
              rowCount: 1,
              rows: [
                { id: 103 },
              ],
            };
          }

          throw new Error(
            "DELETE executado mais vezes do que o esperado."
          );
        }

        if (text === "COMMIT") {
          return {
            rows: [],
          };
        }

        if (text === "ROLLBACK") {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    const result =
      await runAuditLogRetention(
        fakeDb,
        {
          retentionDays: 365,
          action:
            AUDIT_ACTIONS.OS_DELETED,
          mode: MODE_APPLY,
          confirmation:
            "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
          batchSize: 2,
          maxDeletePerRun: 5000,
          now:
            new Date(
              "2026-09-05T12:00:00.000Z"
            ),
        }
      );

    assert.equal(
      result.mode,
      MODE_APPLY
    );

    assert.equal(
      result.eligibleCount,
      3
    );

    assert.equal(
      result.deletedCount,
      3
    );

    assert.equal(
      result.groups.length,
      1
    );

    assert.equal(
      deleteCalls,
      2
    );

    assert.ok(
      commands.some(
        ({ sql }) =>
          sql === "COMMIT"
      )
    );

    assert.equal(
      commands.some(
        ({ sql }) =>
          sql === "ROLLBACK"
      ),
      false
    );
  }
);

test(
  "APPLY faz rollback quando DELETE falha",
  async () => {
    const commands = [];

    const databaseFailure =
      new Error(
        "Falha artificial durante DELETE."
      );

    const fakeDb = {
      async query(sql) {
        const text =
          String(sql).trim();

        commands.push(text);

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                action:
                  AUDIT_ACTIONS.OS_DELETED,
                eligible_count: "2",
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                eligible_count: "2",
              },
            ],
          };
        }

        if (
          /\bDELETE\s+FROM\s+audit_logs\b/i.test(
            text
          )
        ) {
          throw databaseFailure;
        }

        if (text === "ROLLBACK") {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            batchSize: 2,
            maxDeletePerRun: 5000,
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.equal(
          error,
          databaseFailure
        );

        return true;
      }
    );

    assert.ok(
      commands.includes(
        "ROLLBACK"
      )
    );

    assert.equal(
      commands.includes(
        "COMMIT"
      ),
      false
    );
  }
);

test(
  "APPLY reprova pós-validação inconsistente e faz rollback",
  async () => {
    const commands = [];
    let countCalls = 0;

    const fakeDb = {
      async query(sql) {
        const text =
          String(sql).trim();

        commands.push(text);

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                action:
                  AUDIT_ACTIONS.OS_DELETED,
                eligible_count: "2",
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          countCalls += 1;

          return {
            rows: [
              {
                eligible_count:
                  countCalls === 1
                    ? "2"
                    : "1",
              },
            ],
          };
        }

        if (
          /\bDELETE\s+FROM\s+audit_logs\b/i.test(
            text
          )
        ) {
          return {
            rowCount: 2,
            rows: [
              { id: 201 },
              { id: 202 },
            ],
          };
        }

        if (text === "ROLLBACK") {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            batchSize: 500,
            maxDeletePerRun: 5000,
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "AUDIT_RETENTION_POSTCHECK_FAILED"
        );

        return true;
      }
    );

    assert.ok(
      commands.includes(
        "ROLLBACK"
      )
    );

    assert.equal(
      commands.includes(
        "COMMIT"
      ),
      false
    );
  }
);

test(
  "APPLY bloqueia execução concorrente e não executa DELETE",
  async () => {
    const commands = [];

    const fakeDb = {
      async query(sql) {
        const text =
          String(sql).trim();

        commands.push(text);

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: false,
              },
            ],
          };
        }

        if (text === "ROLLBACK") {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "AUDIT_RETENTION_LOCK_UNAVAILABLE"
        );

        return true;
      }
    );

    assert.equal(
      commands.some(
        (sql) =>
          /\bDELETE\b/i.test(sql)
      ),
      false
    );

    assert.ok(
      commands.includes(
        "ROLLBACK"
      )
    );
  }
);

test(
  "APPLY usa client dedicado quando recebe Pool e libera após sucesso",
  async () => {
    let connectCalls = 0;
    let releaseCalls = 0;
    let directPoolQueries = 0;

    const fakeClient = {
      async query(sql) {
        const text =
          String(sql).trim();

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                eligible_count: "0",
              },
            ],
          };
        }

        if (text === "COMMIT") {
          return {
            rows: [],
          };
        }

        if (text === "ROLLBACK") {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado no client: ${text}`
        );
      },

      release() {
        releaseCalls += 1;
      },
    };

    const fakePool = {
      async connect() {
        connectCalls += 1;

        return fakeClient;
      },

      async query() {
        directPoolQueries += 1;

        throw new Error(
          "Pool.query não deve ser usado durante APPLY."
        );
      },
    };

    const result =
      await runAuditLogRetention(
        fakePool,
        {
          retentionDays: 365,
          action:
            AUDIT_ACTIONS.OS_DELETED,
          mode: MODE_APPLY,
          confirmation:
            "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
          now:
            new Date(
              "2026-09-05T12:00:00.000Z"
            ),
        }
      );

    assert.equal(
      result.eligibleCount,
      0
    );

    assert.equal(
      result.deletedCount,
      0
    );

    assert.equal(
      connectCalls,
      1
    );

    assert.equal(
      releaseCalls,
      1
    );

    assert.equal(
      directPoolQueries,
      0
    );
  }
);

test(
  "APPLY libera client dedicado mesmo quando transação falha",
  async () => {
    let connectCalls = 0;
    let releaseCalls = 0;
    let directPoolQueries = 0;

    const fakeClient = {
      async query(sql) {
        const text =
          String(sql).trim();

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: false,
              },
            ],
          };
        }

        if (text === "ROLLBACK") {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado no client: ${text}`
        );
      },

      release() {
        releaseCalls += 1;
      },
    };

    const fakePool = {
      async connect() {
        connectCalls += 1;

        return fakeClient;
      },

      async query() {
        directPoolQueries += 1;

        throw new Error(
          "Pool.query não deve ser usado durante APPLY."
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakePool,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "AUDIT_RETENTION_LOCK_UNAVAILABLE"
        );

        return true;
      }
    );

    assert.equal(
      connectCalls,
      1
    );

    assert.equal(
      releaseCalls,
      1
    );

    assert.equal(
      directPoolQueries,
      0
    );
  }
);

test(
  "DRY_RUN com ALL não adiciona filtro de action e mantém cutoff parametrizado",
  async () => {
    const queries = [];

    const fakeDb = {
      async query(sql, values = []) {
        const text =
          String(sql);

        queries.push({
          sql: text,
          values,
        });

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                eligible_count: "0",
              },
            ],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await runAuditLogRetention(
      fakeDb,
      {
        retentionDays: 365,
        action: ACTION_ALL,
        mode: MODE_DRY_RUN,
        now:
          new Date(
            "2026-09-05T12:00:00.000Z"
          ),
      }
    );

    assert.equal(
      queries.length,
      2
    );

    for (
      const {
        sql,
        values,
      } of queries
    ) {
      assert.match(
        sql,
        /created_at\s*<\s*\$1/i
      );

      assert.doesNotMatch(
        sql,
        /action\s*=\s*\$/i
      );

      assert.deepEqual(
        values,
        [
          "2025-09-05T12:00:00.000Z",
        ]
      );
    }
  }
);

test(
  "filtro de action permanece parametrizado e não é interpolado no SQL",
  async () => {
    const queries = [];

    const fakeDb = {
      async query(sql, values = []) {
        const text =
          String(sql);

        queries.push({
          sql: text,
          values,
        });

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                eligible_count: "0",
              },
            ],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await runAuditLogRetention(
      fakeDb,
      {
        retentionDays: 365,
        action:
          AUDIT_ACTIONS.OS_DELETED,
        mode: MODE_DRY_RUN,
        now:
          new Date(
            "2026-09-05T12:00:00.000Z"
          ),
      }
    );

    for (
      const {
        sql,
        values,
      } of queries
    ) {
      assert.match(
        sql,
        /action\s*=\s*\$2/i
      );

      assert.equal(
        sql.includes(
          AUDIT_ACTIONS.OS_DELETED
        ),
        false
      );

      assert.deepEqual(
        values,
        [
          "2025-09-05T12:00:00.000Z",
          AUDIT_ACTIONS.OS_DELETED,
        ]
      );
    }
  }
);

test(
  "APPLY rejeita rowCount inválido retornado pelo DELETE e faz rollback",
  async () => {
    const commands = [];
    let countCalls = 0;

    const fakeDb = {
      async query(sql) {
        const text =
          String(sql).trim();

        commands.push(text);

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                action:
                  AUDIT_ACTIONS.OS_DELETED,
                eligible_count: "1",
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          countCalls += 1;

          return {
            rows: [
              {
                eligible_count:
                  countCalls === 1
                    ? "1"
                    : "0",
              },
            ],
          };
        }

        if (
          /\bDELETE\s+FROM\s+audit_logs\b/i.test(
            text
          )
        ) {
          return {
            rowCount: "INVALID",
            rows: [],
          };
        }

        if (
          text === "ROLLBACK"
        ) {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "INVALID_AUDIT_RETENTION_DELETE_COUNT"
        );

        return true;
      }
    );

    assert.ok(
      commands.includes(
        "ROLLBACK"
      )
    );

    assert.equal(
      commands.includes(
        "COMMIT"
      ),
      false
    );
  }
);

test(
  "APPLY rejeita DELETE acima do batchSize e faz rollback",
  async () => {
    const commands = [];

    const fakeDb = {
      async query(sql) {
        const text =
          String(sql).trim();

        commands.push(text);

        if (text === "BEGIN") {
          return {
            rows: [],
          };
        }

        if (
          /pg_try_advisory_xact_lock/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                locked: true,
              },
            ],
          };
        }

        if (
          /GROUP BY\s+action/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                action:
                  AUDIT_ACTIONS.OS_DELETED,
                eligible_count: "3",
              },
            ],
          };
        }

        if (
          /COUNT\(\*\)/i.test(
            text
          )
        ) {
          return {
            rows: [
              {
                eligible_count: "3",
              },
            ],
          };
        }

        if (
          /\bDELETE\s+FROM\s+audit_logs\b/i.test(
            text
          )
        ) {
          return {
            rowCount: 3,
            rows: [
              { id: 1 },
              { id: 2 },
              { id: 3 },
            ],
          };
        }

        if (
          text === "ROLLBACK"
        ) {
          return {
            rows: [],
          };
        }

        throw new Error(
          `SQL inesperado: ${text}`
        );
      },
    };

    await assert.rejects(
      () =>
        runAuditLogRetention(
          fakeDb,
          {
            retentionDays: 365,
            action:
              AUDIT_ACTIONS.OS_DELETED,
            mode: MODE_APPLY,
            confirmation:
              "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
            batchSize: 2,
            now:
              new Date(
                "2026-09-05T12:00:00.000Z"
              ),
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            AuditLogRetentionError
        );

        assert.equal(
          error.code,
          "AUDIT_RETENTION_BATCH_LIMIT_EXCEEDED"
        );

        return true;
      }
    );

    assert.ok(
      commands.includes(
        "ROLLBACK"
      )
    );

    assert.equal(
      commands.includes(
        "COMMIT"
      ),
      false
    );
  }
);