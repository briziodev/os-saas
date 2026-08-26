const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SERVER_ROOT = path.resolve(__dirname, "../..");

require("dotenv").config({
  path: path.join(SERVER_ROOT, ".env"),
  quiet: true,
});

const bcrypt = require("bcryptjs");
const {
  BCRYPT_ROUNDS,
} = require("../../utils/passwordPolicy");
const {
  assertSafeIntegrationDatabase,
} = require("../helpers/integrationDbGuard");


const TEST_PASSWORD = "TesteSeguro#2026";
const suffix =
  `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const fixture = {
  companyIds: [],
  userIds: [],
  primaryCompanyId: null,
  externalCompanyId: null,
  adminId: null,
  atendimentoId: null,
  tecnicoId: null,
  externalAdminId: null,
  clienteId: null,
  osId: null,
  pecaId: null,
};

const serverLogs = [];

let backendProcess = null;
let baseUrl = null;
let passedChecks = 0;

function resolveDatabaseTarget() {
  if (process.env.DATABASE_URL) {
    const parsed = new URL(process.env.DATABASE_URL);

    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database:
        decodeURIComponent(
          parsed.pathname.replace(/^\/+/, "")
        ) || "não informado",
      source: "DATABASE_URL",
    };
  }

  return {
    host: String(process.env.DB_HOST || "").trim(),
    port: String(process.env.DB_PORT || "5432").trim(),
    database: String(process.env.DB_NAME || "").trim(),
    source: "DB_*",
  };
}

const databaseTarget = resolveDatabaseTarget();

let pool = null;

function initializeDatabasePool() {
  if (pool) {
    return pool;
  }

  pool = require("../../db");
  return pool;
}

function pass(name) {
  passedChecks += 1;
  console.log(`[PASS] ${name}`);
}

async function expectHttp(
  name,
  requestPromise,
  expectedStatus
) {
  const result = await requestPromise;

  assert.equal(
    result.status,
    expectedStatus,
    [
      `${name}: HTTP esperado ${expectedStatus},`,
      `recebido ${result.status}.`,
      `Resposta: ${JSON.stringify(result.body)}`,
    ].join(" ")
  );

  pass(name);
  return result;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.once("error", reject);

    server.listen(
      {
        host: "127.0.0.1",
        port: 0,
      },
      () => {
        const address = server.address();
        const port = address.port;

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(port);
        });
      }
    );
  });
}

function retainServerLog(chunk, stream) {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean);

  for (const line of lines) {
    serverLogs.push({
      stream,
      line,
    });
  }

  if (serverLogs.length > 100) {
    serverLogs.splice(
      0,
      serverLogs.length - 100
    );
  }
}

async function startBackend() {
  const port = await getFreePort();

  baseUrl = `http://127.0.0.1:${port}`;

  backendProcess = spawn(
    process.execPath,
    ["index.js"],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );

  backendProcess.stdout.on(
    "data",
    (chunk) =>
      retainServerLog(chunk, "stdout")
  );

  backendProcess.stderr.on(
    "data",
    (chunk) =>
      retainServerLog(chunk, "stderr")
  );

  for (
    let attempt = 1;
    attempt <= 40;
    attempt += 1
  ) {
    if (backendProcess.exitCode !== null) {
      throw new Error(
        `Backend encerrou antes de iniciar. Exit code: ${backendProcess.exitCode}`
      );
    }

    try {
      const response = await fetch(
        `${baseUrl}/ready`,
        {
          signal:
            AbortSignal.timeout(2_000),
        }
      );

      const body = await response.json();

      if (
        response.status === 200 &&
        body.status === "ready" &&
        body.schema === "compatible"
      ) {
        return;
      }
    } catch {
      // Aguarda o backend temporário iniciar.
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );
  }

  throw new Error(
    "Backend temporário não ficou pronto."
  );
}

async function stopBackend() {
  if (
    !backendProcess ||
    backendProcess.exitCode !== null
  ) {
    return;
  }

  backendProcess.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) =>
      backendProcess.once("exit", resolve)
    ),

    new Promise((resolve) =>
      setTimeout(resolve, 2_000)
    ),
  ]);

  if (backendProcess.exitCode === null) {
    backendProcess.kill("SIGKILL");
  }
}

async function apiRequest(
  route,
  {
    method = "GET",
    token,
    body,
  } = {}
) {
  const headers = {
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] =
      "application/json";
  }

  const response = await fetch(
    `${baseUrl}${route}`,
    {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : JSON.stringify(body),

      signal:
        AbortSignal.timeout(10_000),
    }
  );

  const text = await response.text();

  let responseBody = null;

  if (text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = {
        raw: text.slice(0, 500),
      };
    }
  }

  return {
    status: response.status,
    body: responseBody,
  };
}

async function login(email) {
  const result = await apiRequest(
    "/auth/login",
    {
      method: "POST",
      body: {
        email,
        password: TEST_PASSWORD,
      },
    }
  );

  assert.equal(
    result.status,
    200,
    `Login falhou para ${email}: ${JSON.stringify(result.body)}`
  );

  assert.equal(
    typeof result.body?.token,
    "string",
    `Token ausente no login de ${email}.`
  );

  return result.body.token;
}

async function createFixtures() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const companies =
      await client.query(
        `
          INSERT INTO companies (name)
          VALUES ($1), ($2)
          RETURNING id, name
        `,
        [
          `Regressão OS ${suffix}`,
          `Tenant externo ${suffix}`,
        ]
      );

    fixture.primaryCompanyId =
      companies.rows[0].id;

    fixture.externalCompanyId =
      companies.rows[1].id;

    fixture.companyIds.push(
      fixture.primaryCompanyId,
      fixture.externalCompanyId
    );

    const passwordHash =
      await bcrypt.hash(
        TEST_PASSWORD,
        BCRYPT_ROUNDS
      );

    const users = await client.query(
      `
        INSERT INTO users
          (
            name,
            email,
            password_hash,
            company_id,
            role,
            is_active,
            activated_at,
            session_version,
            password_changed_at
          )
        VALUES
          ($1, $2, $3, $4, 'admin', true, now(), 1, now()),
          ($5, $6, $3, $4, 'atendimento', true, now(), 1, now()),
          ($7, $8, $3, $4, 'tecnico', true, now(), 1, now()),
          ($9, $10, $3, $11, 'admin', true, now(), 1, now())
        RETURNING id, email, role, company_id
      `,
      [
        "Admin Regressão",
        `admin.regressao.${suffix}@teste.local`,
        passwordHash,
        fixture.primaryCompanyId,

        "Atendimento Regressão",
        `atendimento.regressao.${suffix}@teste.local`,

        "Técnico Regressão",
        `tecnico.regressao.${suffix}@teste.local`,

        "Admin Tenant Externo",
        `externo.regressao.${suffix}@teste.local`,
        fixture.externalCompanyId,
      ]
    );

    for (const user of users.rows) {
      fixture.userIds.push(user.id);

      if (
        Number(user.company_id) ===
          Number(fixture.primaryCompanyId) &&
        user.role === "admin"
      ) {
        fixture.adminId = user.id;
      }

      if (
        Number(user.company_id) ===
          Number(fixture.primaryCompanyId) &&
        user.role === "atendimento"
      ) {
        fixture.atendimentoId = user.id;
      }

      if (
        Number(user.company_id) ===
          Number(fixture.primaryCompanyId) &&
        user.role === "tecnico"
      ) {
        fixture.tecnicoId = user.id;
      }

      if (
        Number(user.company_id) ===
          Number(fixture.externalCompanyId) &&
        user.role === "admin"
      ) {
        fixture.externalAdminId = user.id;
      }
    }

    const cliente = await client.query(
      `
        INSERT INTO clientes
          (
            nome,
            email,
            telefone,
            user_id,
            company_id
          )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [
        "Cliente Regressão",
        `cliente.${suffix}@teste.local`,
        "5544999999999",
        fixture.adminId,
        fixture.primaryCompanyId,
      ]
    );

    fixture.clienteId =
      cliente.rows[0].id;

    const ordemServico =
      await client.query(
        `
          INSERT INTO ordens_servico
            (
              cliente_id,
              placa,
              modelo,
              problema_relatado,
              mao_obra,
              valor_pecas,
              valor_total,
              status,
              closed_at,
              user_id,
              company_id
            )
          VALUES
            (
              $1,
              'TST1A23',
              'Veículo de regressão',
              'OS descartável para regressão de cancelamento',
              100,
              50,
              150,
              'cancelado',
              now(),
              $2,
              $3
            )
          RETURNING id
        `,
        [
          fixture.clienteId,
          fixture.adminId,
          fixture.primaryCompanyId,
        ]
      );

    fixture.osId =
      ordemServico.rows[0].id;

    const peca = await client.query(
      `
        INSERT INTO os_pecas
          (
            os_id,
            company_id,
            nome,
            quantidade,
            valor_unitario
          )
        VALUES
          ($1, $2, 'Peça original', 1, 50)
        RETURNING id
      `,
      [
        fixture.osId,
        fixture.primaryCompanyId,
      ]
    );

    fixture.pecaId =
      peca.rows[0].id;

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

async function cleanupFixtures() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (fixture.companyIds.length > 0) {
      await client.query(
        `
          DELETE FROM audit_logs
          WHERE company_id = ANY($1::int[])
        `,
        [fixture.companyIds]
      );

      await client.query(
        `
          DELETE FROM os_events
          WHERE company_id = ANY($1::int[])
        `,
        [fixture.companyIds]
      );

      await client.query(
        `
          DELETE FROM os_pecas
          WHERE company_id = ANY($1::int[])
        `,
        [fixture.companyIds]
      );

      await client.query(
        `
          DELETE FROM ordens_servico
          WHERE company_id = ANY($1::int[])
        `,
        [fixture.companyIds]
      );

      await client.query(
        `
          DELETE FROM clientes
          WHERE company_id = ANY($1::int[])
        `,
        [fixture.companyIds]
      );
    }

    if (fixture.userIds.length > 0) {
      await client.query(
        `
          DELETE FROM password_reset_tokens
          WHERE user_id = ANY($1::int[])
        `,
        [fixture.userIds]
      );

      await client.query(
        `
          DELETE FROM users
          WHERE id = ANY($1::int[])
        `,
        [fixture.userIds]
      );
    }

    if (fixture.companyIds.length > 0) {
      await client.query(
        `
          DELETE FROM companies
          WHERE id = ANY($1::int[])
        `,
        [fixture.companyIds]
      );
    }

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

async function getSnapshot() {
  const osResult = await pool.query(
    `
      SELECT
        id,
        status::text AS status,
        problema_relatado,
        mao_obra,
        valor_pecas,
        valor_total,
        closed_at
      FROM ordens_servico
      WHERE id = $1
        AND company_id = $2
    `,
    [
      fixture.osId,
      fixture.primaryCompanyId,
    ]
  );

  assert.equal(
    osResult.rowCount,
    1,
    "Fixture da OS não encontrada."
  );

  const partsResult = await pool.query(
    `
      SELECT
        id,
        nome,
        quantidade,
        valor_unitario
      FROM os_pecas
      WHERE os_id = $1
        AND company_id = $2
      ORDER BY id
    `,
    [
      fixture.osId,
      fixture.primaryCompanyId,
    ]
  );

  const eventsResult = await pool.query(
    `
      SELECT
        id,
        user_id,
        event_type,
        metadata
      FROM os_events
      WHERE os_id = $1
        AND company_id = $2
      ORDER BY id
    `,
    [
      fixture.osId,
      fixture.primaryCompanyId,
    ]
  );

  return {
    os: osResult.rows[0],
    parts: partsResult.rows,
    events: eventsResult.rows,
  };
}


async function getAuditLogs() {
  const result =
    await pool.query(
      `
        SELECT
          id,
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
        FROM audit_logs
        WHERE company_id = $1
          AND entity_type = 'ordem_servico'
          AND entity_id = $2
        ORDER BY id
      `,
      [
        fixture.primaryCompanyId,
        fixture.osId,
      ]
    );

  return result.rows;
}


async function runRegression() {
  const emails = {
    admin:
      `admin.regressao.${suffix}@teste.local`,

    atendimento:
      `atendimento.regressao.${suffix}@teste.local`,

    tecnico:
      `tecnico.regressao.${suffix}@teste.local`,

    externalAdmin:
      `externo.regressao.${suffix}@teste.local`,
  };

  const tokens = {
    admin: await login(emails.admin),

    atendimento:
      await login(emails.atendimento),

    tecnico:
      await login(emails.tecnico),

    externalAdmin:
      await login(emails.externalAdmin),
  };

  const initialSnapshot =
    await getSnapshot();

  assert.equal(
    initialSnapshot.os.status,
    "cancelado"
  );

  assert.equal(
    initialSnapshot.parts.length,
    1
  );

  const legacySnapshotBefore =
    await getSnapshot();

  const legacyResponse =
    await apiRequest(
      `/os/${fixture.osId}/whatsapp-link`,
      {
        token: tokens.admin,
      }
    );

  assert.equal(
    legacyResponse.status,
    410
  );

  assert.equal(
    legacyResponse.body?.code,
    "WHATSAPP_LEGACY_ENDPOINT_GONE"
  );

  const legacySnapshotAfter =
    await getSnapshot();

  assert.deepEqual(
    legacySnapshotAfter,
    legacySnapshotBefore
  );

  pass(
    "Endpoint legado GET do WhatsApp está descontinuado e não altera dados"
  );

  await expectHttp(
    "Editar descrição de OS cancelada",
    apiRequest(
      `/os/${fixture.osId}`,
      {
        method: "PUT",
        token: tokens.admin,
        body: {
          problema_relatado:
            "Alteração que deve ser bloqueada",
        },
      }
    ),
    409
  );

  await expectHttp(
    "Alterar diretamente o status da OS cancelada",
    apiRequest(
      `/os/${fixture.osId}`,
      {
        method: "PUT",
        token: tokens.admin,
        body: {
          status: "triagem",
        },
      }
    ),
    409
  );

  await expectHttp(
    "Adicionar peça em OS cancelada",
    apiRequest(
      `/os/${fixture.osId}/pecas`,
      {
        method: "POST",
        token: tokens.admin,
        body: {
          nome: "Peça indevida",
          quantidade: 1,
          valor_unitario: 25,
        },
      }
    ),
    409
  );

  await expectHttp(
    "Editar peça de OS cancelada",
    apiRequest(
      `/os/${fixture.osId}/pecas/${fixture.pecaId}`,
      {
        method: "PUT",
        token: tokens.admin,
        body: {
          nome: "Peça alterada",
          quantidade: 2,
          valor_unitario: 30,
        },
      }
    ),
    409
  );

  await expectHttp(
    "Excluir peça de OS cancelada",
    apiRequest(
      `/os/${fixture.osId}/pecas/${fixture.pecaId}`,
      {
        method: "DELETE",
        token: tokens.admin,
      }
    ),
    409
  );

  await expectHttp(
    "Gerar orçamento de OS cancelada",
    apiRequest(
      `/os/${fixture.osId}/enviar-orcamento`,
      {
        method: "POST",
        token: tokens.admin,
      }
    ),
    409
  );

  await expectHttp(
    "Excluir OS cancelada",
    apiRequest(
      `/os/${fixture.osId}`,
      {
        method: "DELETE",
        token: tokens.admin,
      }
    ),
    409
  );

  const validReason =
    "Cliente autorizou formalmente a retomada do diagnóstico.";

  await expectHttp(
    "Atendimento não pode reabrir",
    apiRequest(
      `/os/${fixture.osId}/reabrir`,
      {
        method: "POST",
        token: tokens.atendimento,
        body: {
          motivo: validReason,
        },
      }
    ),
    403
  );

  await expectHttp(
    "Técnico não pode reabrir",
    apiRequest(
      `/os/${fixture.osId}/reabrir`,
      {
        method: "POST",
        token: tokens.tecnico,
        body: {
          motivo: validReason,
        },
      }
    ),
    403
  );

  await expectHttp(
    "Outro tenant não encontra a OS",
    apiRequest(
      `/os/${fixture.osId}/reabrir`,
      {
        method: "POST",
        token: tokens.externalAdmin,
        body: {
          motivo: validReason,
        },
      }
    ),
    404
  );

  await expectHttp(
    "Admin não reabre com motivo curto",
    apiRequest(
      `/os/${fixture.osId}/reabrir`,
      {
        method: "POST",
        token: tokens.admin,
        body: {
          motivo: "Curto",
        },
      }
    ),
    400
  );

  const blockedSnapshot =
    await getSnapshot();

  assert.equal(
    blockedSnapshot.os.status,
    "cancelado"
  );

  assert.equal(
    blockedSnapshot.os.problema_relatado,
    initialSnapshot.os.problema_relatado
  );

  assert.equal(
    blockedSnapshot.parts.length,
    1
  );

  assert.equal(
    blockedSnapshot.parts[0].id,
    fixture.pecaId
  );

  assert.equal(
    blockedSnapshot.parts[0].nome,
    "Peça original"
  );

  assert.equal(
    blockedSnapshot.events.length,
    initialSnapshot.events.length
  );

  pass(
    "Tentativas bloqueadas não alteraram dados"
  );

  const reopenResult = await expectHttp(
    "Admin reabre com motivo válido",
    apiRequest(
      `/os/${fixture.osId}/reabrir`,
      {
        method: "POST",
        token: tokens.admin,
        body: {
          motivo: validReason,
        },
      }
    ),
    200
  );

  assert.equal(
    reopenResult.body?.status,
    "triagem"
  );

  const finalSnapshot =
    await getSnapshot();

  assert.equal(
    finalSnapshot.os.status,
    "triagem"
  );

  assert.equal(
    finalSnapshot.os.closed_at,
    null
  );

  const reopenEvents =
    finalSnapshot.events.filter(
      (event) =>
        event.event_type ===
        "os_reopened"
    );

  assert.equal(
    reopenEvents.length,
    1
  );

  const reopenEvent =
    reopenEvents[0];

  assert.equal(
    Number(reopenEvent.user_id),
    Number(fixture.adminId)
  );

  assert.deepEqual(
    {
      old_status:
        reopenEvent.metadata?.old_status,

      new_status:
        reopenEvent.metadata?.new_status,

      reason:
        reopenEvent.metadata?.reason,

      source:
        reopenEvent.metadata?.source,
    },
    {
      old_status: "cancelado",
      new_status: "triagem",
      reason: validReason,
      source: "controlled_reopen",
    }
  );

  pass(
    "Reabertura persistiu triagem e evento auditável"
  );

  const auditAfterReopen =
    await getAuditLogs();

  const reopenAuditRows =
    auditAfterReopen.filter(
      (row) =>
        row.action ===
        "OS_REOPENED"
    );

  assert.equal(
    reopenAuditRows.length,
    1
  );

  const reopenAudit =
    reopenAuditRows[0];

  assert.equal(
    Number(
      reopenAudit.actor_user_id
    ),
    Number(fixture.adminId)
  );

  assert.equal(
    reopenAudit.actor_role,
    "admin"
  );

  assert.deepEqual(
    {
      old_status:
        reopenAudit.metadata
          ?.old_status,

      new_status:
        reopenAudit.metadata
          ?.new_status,

      reason:
        reopenAudit.metadata
          ?.reason,

      source:
        reopenAudit.metadata
          ?.source,
    },
    {
      old_status:
        "cancelado",
      new_status:
        "triagem",
      reason:
        validReason,
      source:
        "controlled_reopen",
    }
  );

  pass(
    "Reabertura gerou audit_log persistente do tenant"
  );

  await expectHttp(
    "Admin exclui OS reaberta",
    apiRequest(
      `/os/${fixture.osId}`,
      {
        method: "DELETE",
        token: tokens.admin,
      }
    ),
    200
  );

  const deletedOsResult =
    await pool.query(
      `
        SELECT id
        FROM ordens_servico
        WHERE id = $1
          AND company_id = $2
      `,
      [
        fixture.osId,
        fixture.primaryCompanyId,
      ]
    );

  assert.equal(
    deletedOsResult.rowCount,
    0
  );

  const auditAfterDelete =
    await getAuditLogs();

  const deleteAuditRows =
    auditAfterDelete.filter(
      (row) =>
        row.action ===
        "OS_DELETED"
    );

  assert.equal(
    deleteAuditRows.length,
    1
  );

  const deleteAudit =
    deleteAuditRows[0];

  assert.equal(
    Number(
      deleteAudit.actor_user_id
    ),
    Number(fixture.adminId)
  );

  assert.equal(
    deleteAudit.actor_role,
    "admin"
  );

  assert.equal(
    Number(
      deleteAudit.entity_id
    ),
    Number(fixture.osId)
  );

  assert.equal(
    deleteAudit.metadata
      ?.status_before,
    "triagem"
  );

  assert.equal(
    auditAfterDelete.some(
      (row) =>
        row.action ===
        "OS_REOPENED"
    ),
    true,
    "O audit_log de reabertura deve sobreviver à exclusão da OS."
  );

  pass(
    "Exclusão gerou audit_log que sobrevive à remoção da OS"
  );
}

async function main() {
  let mainError = null;
  let cleanupError = null;
  let databaseApproved = false;

  try {
    assertSafeIntegrationDatabase({
      target: databaseTarget,
      confirmation:
        process.env.OS_SAAS_INTEGRATION_TEST,
    });

    databaseApproved = true;
    initializeDatabasePool();

    console.log(
      JSON.stringify(
        {
          status: "starting",
          target: databaseTarget,
        },
        null,
        2
      )
    );

    await createFixtures();
    await startBackend();
    await runRegression();
  } catch (error) {
    mainError = error;

    console.error(
      JSON.stringify(
        {
          status: "failed",
          errorName: error.name,
          errorMessage: error.message,
        },
        null,
        2
      )
    );
  } finally {
    await stopBackend()
      .catch((error) => {
        console.error(
          "Falha ao encerrar backend:",
          error.message
        );
      });

    if (databaseApproved && pool) {
      try {
        await cleanupFixtures();
        console.log(
          "Fixtures temporárias removidas."
        );
      } catch (error) {
        cleanupError = error;

        console.error(
          JSON.stringify(
            {
              status: "cleanup_failed",
              errorName: error.name,
              errorMessage: error.message,
              companyIds: fixture.companyIds,
              userIds: fixture.userIds,
            },
            null,
            2
          )
        );
      }
    }

    if (pool) {
      await pool.end()
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
          total: 18,
          passed: passedChecks,
          failed: 18 - passedChecks,
        },
      },
      null,
      2
    )
  );

  if (mainError) {
    console.error(
      "\nÚltimos logs do backend:"
    );

    for (
      const item
      of serverLogs.slice(-30)
    ) {
      console.error(
        `[${item.stream}] ${item.line}`
      );
    }
  }

  if (mainError || cleanupError) {
    process.exitCode = 1;
  }
}

main();
