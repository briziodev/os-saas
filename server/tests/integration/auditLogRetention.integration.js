const assert = require("node:assert/strict");
const path = require("node:path");

const SERVER_ROOT =
  path.resolve(__dirname, "../..");

require("dotenv").config({
  path: path.join(SERVER_ROOT, ".env"),
  quiet: true,
});

const {
  assertSafeIntegrationDatabase,
} = require("../helpers/integrationDbGuard");

const {
  AUDIT_ACTIONS,
} = require("../../services/auditLog");

const {
  ACTION_ALL,
  MODE_APPLY,
  MODE_DRY_RUN,
  runAuditLogRetention,
} = require("../../services/auditLogRetention");

const suffix =
  `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 10)}`;

let pool = null;
let companyId = null;
let passedChecks = 0;

function resolveDatabaseTarget() {
  if (process.env.DATABASE_URL) {
    const parsed =
      new URL(
        process.env.DATABASE_URL
      );

    return {
      host: parsed.hostname,
      port:
        parsed.port || "5432",
      database:
        decodeURIComponent(
          parsed.pathname.replace(
            /^\/+/,
            ""
          )
        ) || "nao informado",
      source: "DATABASE_URL",
    };
  }

  return {
    host:
      String(
        process.env.DB_HOST || ""
      ).trim(),

    port:
      String(
        process.env.DB_PORT || "5432"
      ).trim(),

    database:
      String(
        process.env.DB_NAME || ""
      ).trim(),

    source: "DB_*",
  };
}

function initializeDatabasePool() {
  if (pool) {
    return pool;
  }

  /*
   * db.js somente é carregado
   * depois que o guard aprovar
   * explicitamente o destino.
   */
  pool = require("../../db");

  return pool;
}

function pass(name) {
  passedChecks += 1;

  console.log(
    `[PASS] ${name}`
  );
}

async function assertNoPreexistingEligibleAuditLogs() {
  const result =
    await pool.query(
      `
        SELECT
          COUNT(*)::int AS total
        FROM audit_logs
        WHERE created_at <
          (
            NOW() -
            (
              $1::int *
              INTERVAL '1 day'
            )
          )
      `,
      [365]
    );

  const total =
    Number(
      result.rows[0].total
    );

  assert.equal(
    total,
    0,
    [
      "Teste bloqueado: os_saas_test possui",
      `${total} audit_logs preexistentes`,
      "que já seriam elegíveis para retenção.",
      "Nenhum APPLY foi executado.",
    ].join(" ")
  );

  pass(
    "banco de integração não possui audit_logs preexistentes elegíveis"
  );
}

async function createFixture() {
  const companyResult =
    await pool.query(
      `
        INSERT INTO companies (
          name
        )
        VALUES ($1)
        RETURNING id
      `,
      [
        `Audit Retention Integration ${suffix}`,
      ]
    );

  companyId =
    Number(
      companyResult.rows[0].id
    );

  assert.ok(
    Number.isInteger(companyId) &&
      companyId > 0
  );

  const oldDate =
    "2020-01-01T00:00:00.000Z";

  const recentDate =
    new Date().toISOString();

  const rows = [
    {
      action:
        AUDIT_ACTIONS.OS_DELETED,
      requestId:
        `audit-retention-old-os-1-${suffix}`,
      createdAt: oldDate,
    },
    {
      action:
        AUDIT_ACTIONS.OS_DELETED,
      requestId:
        `audit-retention-old-os-2-${suffix}`,
      createdAt: oldDate,
    },
    {
      action:
        AUDIT_ACTIONS.OS_DELETED,
      requestId:
        `audit-retention-new-os-${suffix}`,
      createdAt: recentDate,
    },
    {
      action:
        AUDIT_ACTIONS.CLIENT_ARCHIVED,
      requestId:
        `audit-retention-old-client-${suffix}`,
      createdAt: oldDate,
    },
  ];

  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO audit_logs (
          company_id,
          actor_user_id,
          actor_role,
          action,
          entity_type,
          entity_id,
          request_id,
          ip,
          metadata,
          created_at
        )
        VALUES (
          $1,
          NULL,
          NULL,
          $2,
          'audit_retention_integration',
          NULL,
          $3,
          '127.0.0.1',
          $4::jsonb,
          $5::timestamptz
        )
      `,
      [
        companyId,
        row.action,
        row.requestId,
        JSON.stringify({
          fixture: true,
          suffix,
        }),
        row.createdAt,
      ]
    );
  }

  const countResult =
    await pool.query(
      `
        SELECT COUNT(*)::int
          AS total
        FROM audit_logs
        WHERE company_id = $1
      `,
      [companyId]
    );

  assert.equal(
    Number(
      countResult.rows[0].total
    ),
    4
  );

  pass(
    "fixture isolada criada com 4 audit logs"
  );
}

async function assertCompanyAuditCount(
  expected
) {
  const result =
    await pool.query(
      `
        SELECT COUNT(*)::int
          AS total
        FROM audit_logs
        WHERE company_id = $1
      `,
      [companyId]
    );

  assert.equal(
    Number(result.rows[0].total),
    expected
  );
}

async function runRegression() {
  /*
   * 1. DRY_RUN da ação OS_DELETED.
   *
   * Deve identificar somente os
   * dois registros antigos sem
   * remover absolutamente nada.
   */
  const dryRun =
    await runAuditLogRetention(
      pool,
      {
        retentionDays: 365,
        action:
          AUDIT_ACTIONS.OS_DELETED,
        mode: MODE_DRY_RUN,
      }
    );

  assert.equal(
    dryRun.mode,
    MODE_DRY_RUN
  );

  assert.equal(
    dryRun.eligibleCount,
    2
  );

  assert.equal(
    dryRun.deletedCount,
    0
  );

  await assertCompanyAuditCount(4);

  pass(
    "DRY_RUN conta 2 elegíveis e não remove dados"
  );

  /*
   * 2. APPLY específico.
   *
   * Remove somente os dois
   * OS_DELETED antigos.
   */
  const applyAction =
    await runAuditLogRetention(
      pool,
      {
        retentionDays: 365,
        action:
          AUDIT_ACTIONS.OS_DELETED,
        mode: MODE_APPLY,
        confirmation:
          "PURGE_AUDIT_LOGS_365_DAYS_OS_DELETED",
        batchSize: 1,
        maxDeletePerRun: 10,
      }
    );

  assert.equal(
    applyAction.mode,
    MODE_APPLY
  );

  assert.equal(
    applyAction.eligibleCount,
    2
  );

  assert.equal(
    applyAction.deletedCount,
    2
  );

  await assertCompanyAuditCount(2);

  const afterSpecific =
    await pool.query(
      `
        SELECT
          action,
          created_at
        FROM audit_logs
        WHERE company_id = $1
        ORDER BY id
      `,
      [companyId]
    );

  assert.equal(
    afterSpecific.rows.length,
    2
  );

  assert.equal(
    afterSpecific.rows.some(
      (row) =>
        row.action ===
          AUDIT_ACTIONS.OS_DELETED
    ),
    true
  );

  assert.equal(
    afterSpecific.rows.some(
      (row) =>
        row.action ===
          AUDIT_ACTIONS.CLIENT_ARCHIVED
    ),
    true
  );

  pass(
    "APPLY específico remove somente registros antigos da ação selecionada"
  );

  /*
   * 3. APPLY ALL.
   *
   * Agora somente o
   * CLIENT_ARCHIVED antigo deve
   * ser elegível.
   *
   * O OS_DELETED recente precisa
   * permanecer.
   */
  const applyAll =
    await runAuditLogRetention(
      pool,
      {
        retentionDays: 365,
        action: ACTION_ALL,
        mode: MODE_APPLY,
        confirmation:
          "PURGE_AUDIT_LOGS_365_DAYS_ALL",
        batchSize: 1,
        maxDeletePerRun: 10,
      }
    );

  assert.equal(
    applyAll.eligibleCount,
    1
  );

  assert.equal(
    applyAll.deletedCount,
    1
  );

  await assertCompanyAuditCount(1);

  const finalResult =
    await pool.query(
      `
        SELECT
          action,
          created_at
        FROM audit_logs
        WHERE company_id = $1
      `,
      [companyId]
    );

  assert.equal(
    finalResult.rows.length,
    1
  );

  assert.equal(
    finalResult.rows[0].action,
    AUDIT_ACTIONS.OS_DELETED
  );

  const finalCreatedAt =
    new Date(
      finalResult.rows[0]
        .created_at
    );

  const oneYearAgo =
    new Date(
      Date.now() -
        365 *
          24 *
          60 *
          60 *
          1000
    );

  assert.ok(
    finalCreatedAt > oneYearAgo
  );

  pass(
    "APPLY ALL remove somente o restante elegível e preserva registro recente"
  );
}

async function cleanupFixture() {
  if (
    !pool ||
    !companyId
  ) {
    return;
  }

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM audit_logs
        WHERE company_id = $1
      `,
      [companyId]
    );

    await client.query(
      `
        DELETE FROM companies
        WHERE id = $1
      `,
      [companyId]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client
      .query("ROLLBACK")
      .catch(() => {});

    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  let mainError = null;
  let cleanupError = null;
  let databaseApproved = false;

  const target =
    resolveDatabaseTarget();

  try {
    assertSafeIntegrationDatabase({
      target,
      confirmation:
        process.env
          .OS_SAAS_INTEGRATION_TEST,
    });

    databaseApproved = true;

initializeDatabasePool();

await assertNoPreexistingEligibleAuditLogs();

console.log(
      JSON.stringify(
        {
          status: "starting",
          target,
        },
        null,
        2
      )
    );

    await createFixture();
    await runRegression();
  } catch (error) {
    mainError = error;

    console.error(
      JSON.stringify(
        {
          status: "failed",
          errorName:
            error.name,
          errorMessage:
            error.message,
        },
        null,
        2
      )
    );
  } finally {
    if (
      databaseApproved &&
      pool
    ) {
      try {
        await cleanupFixture();

        console.log(
          "Fixture temporaria removida."
        );
      } catch (error) {
        cleanupError = error;

        console.error(
          JSON.stringify(
            {
              status:
                "cleanup_failed",
              errorName:
                error.name,
              errorMessage:
                error.message,
              companyId,
            },
            null,
            2
          )
        );
      }
    }

    if (pool) {
      await pool
        .end()
        .catch(() => {});
    }
  }

  console.log(
    JSON.stringify(
      {
        status:
          !mainError &&
          !cleanupError
            ? "passed"
            : "failed",
        tests: {
          passed:
            passedChecks,
        },
      },
      null,
      2
    )
  );

  if (
    mainError ||
    cleanupError
  ) {
    process.exitCode = 1;
  }
}

main();