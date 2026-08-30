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
  primaryAdminId: null,
  externalAdminId: null,
  externalAtendimentoId: null,
  primaryClientId: null,
  externalClientId: null,
};

const serverLogs = [];

let pool = null;
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

  if (serverLogs.length > 120) {
    serverLogs.splice(
      0,
      serverLogs.length - 120
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
          RETURNING id
        `,
        [
          `Tenant A clientes ${suffix}`,
          `Tenant B clientes ${suffix}`,
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
          ($5, $6, $3, $7, 'admin', true, now(), 1, now()),
          ($8, $9, $3, $7, 'atendimento', true, now(), 1, now())
        RETURNING id, company_id, role
      `,
      [
        "Admin Cliente Tenant A",
        `admin.cliente.a.${suffix}@teste.local`,
        passwordHash,
        fixture.primaryCompanyId,

        "Admin Cliente Tenant B",
        `admin.cliente.b.${suffix}@teste.local`,
        fixture.externalCompanyId,

        "Atendimento Cliente Tenant B",
        `atendimento.cliente.b.${suffix}@teste.local`,
      ]
    );

    for (const user of users.rows) {
      fixture.userIds.push(user.id);

      if (
        Number(user.company_id) ===
          Number(fixture.primaryCompanyId) &&
        user.role === "admin"
      ) {
        fixture.primaryAdminId = user.id;
      }

      if (
        Number(user.company_id) ===
          Number(fixture.externalCompanyId) &&
        user.role === "admin"
      ) {
        fixture.externalAdminId = user.id;
      }

      if (
        Number(user.company_id) ===
          Number(fixture.externalCompanyId) &&
        user.role === "atendimento"
      ) {
        fixture.externalAtendimentoId = user.id;
      }
    }

    const clients = await client.query(
      `
        INSERT INTO clientes
          (
            nome,
            email,
            telefone,
            user_id,
            company_id
          )
        VALUES
          ($1, $2, $3, $4, $5),
          ($6, $7, $8, $9, $10)
        RETURNING id, company_id
      `,
      [
        "Cliente Alvo Tenant A",
        `alvo.a.${suffix}@teste.local`,
        "44999999991",
        fixture.primaryAdminId,
        fixture.primaryCompanyId,

        "Cliente Base Tenant B",
        `base.b.${suffix}@teste.local`,
        "44999999992",
        fixture.externalAdminId,
        fixture.externalCompanyId,
      ]
    );

    for (const item of clients.rows) {
      if (
        Number(item.company_id) ===
        Number(fixture.primaryCompanyId)
      ) {
        fixture.primaryClientId = item.id;
      }

      if (
        Number(item.company_id) ===
        Number(fixture.externalCompanyId)
      ) {
        fixture.externalClientId = item.id;
      }
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

async function getIsolationSnapshot() {
  const primaryClientResult =
    await pool.query(
      `
        SELECT
          id,
          nome,
          email,
          telefone,
          user_id,
          company_id
        FROM clientes
        WHERE id = $1
          AND company_id = $2
      `,
      [
        fixture.primaryClientId,
        fixture.primaryCompanyId,
      ]
    );

  assert.equal(
    primaryClientResult.rowCount,
    1,
    "Cliente alvo do Tenant A não encontrado."
  );

  const externalCountResult =
    await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM clientes
        WHERE company_id = $1
      `,
      [fixture.externalCompanyId]
    );

  return {
    primaryClient:
      primaryClientResult.rows[0],
    externalClientCount:
      externalCountResult.rows[0].total,
  };
}

async function runRegression() {
  const externalEmail =
    `admin.cliente.b.${suffix}@teste.local`;

  const externalToken =
    await login(externalEmail);

  const atendimentoEmail =
    `atendimento.cliente.b.${suffix}@teste.local`;

  const atendimentoToken =
    await login(atendimentoEmail);

  const initialSnapshot =
    await getIsolationSnapshot();

  const listResult =
    await apiRequest(
      "/clientes",
      {
        token: externalToken,
      }
    );

  assert.equal(
    listResult.status,
    200,
    `GET /clientes retornou HTTP ${listResult.status}: ${JSON.stringify(listResult.body)}`
  );

  assert.ok(
    Array.isArray(listResult.body),
    "GET /clientes deveria retornar uma lista."
  );

  assert.ok(
    listResult.body.some(
      (item) =>
        Number(item.id) ===
        Number(fixture.externalClientId)
    ),
    "Tenant B não recebeu seu cliente base."
  );

  assert.ok(
    listResult.body.every(
      (item) =>
        Number(item.id) !==
        Number(fixture.primaryClientId)
    ),
    "Tenant B recebeu cliente pertencente ao Tenant A."
  );

  pass(
    "Tenant B lista apenas clientes ativos da própria empresa"
  );

  const createdResult =
    await apiRequest(
      "/clientes",
      {
        method: "POST",
        token: externalToken,
        body: {
          nome:
            "Cliente Ciclo Arquivamento Tenant B",
          email:
            `ciclo.b.${suffix}@teste.local`,
          telefone:
            "44999999993",
        },
      }
    );

  assert.equal(
    createdResult.status,
    201,
    `POST /clientes retornou HTTP ${createdResult.status}: ${JSON.stringify(createdResult.body)}`
  );

  const createdClientId =
    Number(createdResult.body?.id);

  assert.ok(
    Number.isInteger(createdClientId) &&
      createdClientId > 0,
    "Cliente criado sem id válido."
  );

  assert.equal(
    Number(createdResult.body?.company_id),
    Number(fixture.externalCompanyId)
  );

  assert.equal(
    Number(createdResult.body?.user_id),
    Number(fixture.externalAdminId)
  );

  pass(
    "Tenant B cria cliente ativo vinculado ao próprio tenant"
  );

  const ownUpdateResult =
    await apiRequest(
      `/clientes/${createdClientId}`,
      {
        method: "PUT",
        token: externalToken,
        body: {
          nome:
            "Cliente Ciclo Atualizado Tenant B",
          email:
            `ciclo.atualizado.b.${suffix}@teste.local`,
          telefone:
            "44999999994",
        },
      }
    );

  assert.equal(
    ownUpdateResult.status,
    200,
    `PUT do próprio cliente retornou HTTP ${ownUpdateResult.status}: ${JSON.stringify(ownUpdateResult.body)}`
  );

  assert.equal(
    ownUpdateResult.body?.nome,
    "Cliente Ciclo Atualizado Tenant B"
  );

  pass(
    "Tenant B atualiza cliente ativo da própria empresa"
  );

  await expectHttp(
    "Tenant B não altera cliente do Tenant A",
    apiRequest(
      `/clientes/${fixture.primaryClientId}`,
      {
        method: "PUT",
        token: externalToken,
        body: {
          nome:
            "Tentativa Cruzada Bloqueada",
          email:
            `bloqueado.${suffix}@teste.local`,
          telefone:
            "44999999995",
        },
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não arquiva cliente do Tenant A",
    apiRequest(
      `/clientes/${fixture.primaryClientId}/archive`,
      {
        method: "POST",
        token: externalToken,
        body: {
          motivo:
            "Tentativa cross-tenant bloqueada",
        },
      }
    ),
    404
  );

  await expectHttp(
    "Atendimento não pode arquivar cliente por chamada direta",
    apiRequest(
      `/clientes/${createdClientId}/archive`,
      {
        method: "POST",
        token: atendimentoToken,
        body: {
          motivo:
            "Tentativa de arquivamento por atendimento",
        },
      }
    ),
    403
  );

  const firstArchiveReason =
    "Cliente não utiliza mais a oficina";

  const archiveResult =
    await apiRequest(
      `/clientes/${createdClientId}/archive`,
      {
        method: "POST",
        token: externalToken,
        body: {
          motivo:
            firstArchiveReason,
        },
      }
    );

  assert.equal(
    archiveResult.status,
    200,
    `Arquivamento retornou HTTP ${archiveResult.status}: ${JSON.stringify(archiveResult.body)}`
  );

  assert.equal(
    Number(archiveResult.body?.cliente?.id),
    createdClientId
  );

  assert.ok(
    archiveResult.body?.cliente?.archived_at,
    "Cliente arquivado sem archived_at."
  );

  assert.equal(
    archiveResult.body?.cliente?.archive_reason,
    firstArchiveReason
  );

  pass(
    "Admin do Tenant B arquiva cliente sem OS operacional"
  );

  const archivedDbResult =
    await pool.query(
      `
        SELECT
          archived_at,
          archived_by,
          archive_reason
        FROM clientes
        WHERE id = $1
          AND company_id = $2
      `,
      [
        createdClientId,
        fixture.externalCompanyId,
      ]
    );

  assert.equal(
    archivedDbResult.rowCount,
    1
  );

  assert.ok(
    archivedDbResult.rows[0].archived_at
  );

  assert.equal(
    Number(archivedDbResult.rows[0].archived_by),
    Number(fixture.externalAdminId)
  );

  assert.equal(
    archivedDbResult.rows[0].archive_reason,
    firstArchiveReason
  );

  pass(
    "Arquivamento persiste data, ator e motivo no PostgreSQL"
  );

  const activeAfterArchive =
    await apiRequest(
      "/clientes",
      {
        token: externalToken,
      }
    );

  assert.equal(
    activeAfterArchive.status,
    200
  );

  assert.ok(
    activeAfterArchive.body.every(
      (item) =>
        Number(item.id) !==
        createdClientId
    ),
    "Cliente arquivado permaneceu na lista ativa."
  );

  pass(
    "Cliente arquivado sai da lista operacional ativa"
  );

  const archivedList =
    await apiRequest(
      "/clientes?status=archived",
      {
        token: externalToken,
      }
    );

  assert.equal(
    archivedList.status,
    200
  );

  assert.ok(
    archivedList.body.some(
      (item) =>
        Number(item.id) ===
        createdClientId
    ),
    "Cliente arquivado não apareceu na lista de arquivados."
  );

  pass(
    "Admin encontra cliente na lista de arquivados"
  );

  await expectHttp(
    "Atendimento não pode consultar clientes arquivados por chamada direta",
    apiRequest(
      "/clientes?status=archived",
      {
        token: atendimentoToken,
      }
    ),
    403
  );

  await expectHttp(
    "Atendimento não pode reativar cliente por chamada direta",
    apiRequest(
      `/clientes/${createdClientId}/reactivate`,
      {
        method: "POST",
        token: atendimentoToken,
      }
    ),
    403
  );

  const blockedOsResult =
    await apiRequest(
      "/os",
      {
        method: "POST",
        token: externalToken,
        body: {
          cliente_id:
            createdClientId,
          problema_relatado:
            "Teste de bloqueio para cliente arquivado",
          mao_obra: 100,
          valor_pecas: 50,
          placa: "ARC1V01",
          modelo: "Veículo Teste Arquivado",
        },
      }
    );

  assert.equal(
    blockedOsResult.status,
    400,
    `Nova OS para arquivado deveria falhar: ${JSON.stringify(blockedOsResult.body)}`
  );

  assert.equal(
    blockedOsResult.body?.code,
    "CLIENT_UNAVAILABLE_FOR_OS"
  );

  pass(
    "API bloqueia nova OS para cliente arquivado"
  );

  const firstAuditResult =
    await pool.query(
      `
        SELECT
          action,
          actor_user_id,
          actor_role,
          entity_type,
          entity_id,
          metadata
        FROM audit_logs
        WHERE company_id = $1
          AND entity_type = 'cliente'
          AND entity_id = $2
        ORDER BY id ASC
      `,
      [
        fixture.externalCompanyId,
        createdClientId,
      ]
    );

  assert.equal(
    firstAuditResult.rowCount,
    1
  );

  assert.equal(
    firstAuditResult.rows[0].action,
    "CLIENT_ARCHIVED"
  );

  assert.equal(
    Number(firstAuditResult.rows[0].actor_user_id),
    Number(fixture.externalAdminId)
  );

  assert.equal(
    firstAuditResult.rows[0].actor_role,
    "admin"
  );

  assert.equal(
    firstAuditResult.rows[0].metadata?.reason,
    firstArchiveReason
  );

  pass(
    "CLIENT_ARCHIVED é gravado em auditoria persistente"
  );

  const hardDeleteResult =
    await apiRequest(
      `/clientes/${createdClientId}`,
      {
        method: "DELETE",
        token: externalToken,
      }
    );

  assert.equal(
    hardDeleteResult.status,
    410
  );

  assert.equal(
    hardDeleteResult.body?.code,
    "CLIENT_DELETE_DEPRECATED"
  );

  const stillExistsAfterDelete =
    await pool.query(
      `
        SELECT id
        FROM clientes
        WHERE id = $1
          AND company_id = $2
      `,
      [
        createdClientId,
        fixture.externalCompanyId,
      ]
    );

  assert.equal(
    stillExistsAfterDelete.rowCount,
    1
  );

  pass(
    "Hard delete legado responde 410 e não remove o cliente"
  );

  const reactivateResult =
    await apiRequest(
      `/clientes/${createdClientId}/reactivate`,
      {
        method: "POST",
        token: externalToken,
      }
    );

  assert.equal(
    reactivateResult.status,
    200,
    `Reativação retornou HTTP ${reactivateResult.status}: ${JSON.stringify(reactivateResult.body)}`
  );

  assert.equal(
    reactivateResult.body?.cliente?.archived_at,
    null
  );

  assert.equal(
    reactivateResult.body?.cliente?.archived_by,
    null
  );

  assert.equal(
    reactivateResult.body?.cliente?.archive_reason,
    null
  );

  pass(
    "Admin reativa cliente e limpa estado de arquivamento"
  );

  const afterReactivateAudit =
    await pool.query(
      `
        SELECT action, metadata
        FROM audit_logs
        WHERE company_id = $1
          AND entity_type = 'cliente'
          AND entity_id = $2
        ORDER BY id ASC
      `,
      [
        fixture.externalCompanyId,
        createdClientId,
      ]
    );

  assert.equal(
    afterReactivateAudit.rowCount,
    2
  );

  assert.equal(
    afterReactivateAudit.rows[1].action,
    "CLIENT_REACTIVATED"
  );

  const archivedAtMetadata =
    afterReactivateAudit.rows[1].metadata?.archived_at;

  assert.equal(
    typeof archivedAtMetadata,
    "string"
  );

  assert.ok(
    Number.isFinite(
      Date.parse(archivedAtMetadata)
    ),
    "CLIENT_REACTIVATED não preservou archived_at como ISO válido."
  );

  pass(
    "CLIENT_REACTIVATED é auditado com timestamp JSON seguro"
  );

  const createOsResult =
    await apiRequest(
      "/os",
      {
        method: "POST",
        token: externalToken,
        body: {
          cliente_id:
            createdClientId,
          problema_relatado:
            "OS usada para validar histórico após arquivamento",
          mao_obra: 120,
          valor_pecas: 30,
          placa: "HIS1T01",
          modelo: "Veículo Histórico",
        },
      }
    );

  assert.equal(
    createOsResult.status,
    201,
    `Nova OS após reativação falhou: ${JSON.stringify(createOsResult.body)}`
  );

  const createdOsId =
    Number(createOsResult.body?.id);

  assert.ok(
    Number.isInteger(createdOsId) &&
      createdOsId > 0
  );

  pass(
    "Cliente reativado volta a aceitar nova OS"
  );

  const blockedArchiveByOpenOs =
    await apiRequest(
      `/clientes/${createdClientId}/archive`,
      {
        method: "POST",
        token: externalToken,
        body: {
          motivo:
            "Tentativa com OS aberta",
        },
      }
    );

  assert.equal(
    blockedArchiveByOpenOs.status,
    409
  );

  assert.equal(
    blockedArchiveByOpenOs.body?.code,
    "CLIENT_ARCHIVE_BLOCKED_OPEN_OS"
  );

  assert.equal(
    Number(blockedArchiveByOpenOs.body?.blocking_os?.id),
    createdOsId
  );

  assert.equal(
    blockedArchiveByOpenOs.body?.blocking_os?.status,
    "triagem"
  );

  pass(
    "OS operacional bloqueia arquivamento do cliente"
  );

  const finalizeOsResult =
    await apiRequest(
      `/os/${createdOsId}`,
      {
        method: "PUT",
        token: externalToken,
        body: {
          status: "finalizado",
        },
      }
    );

  assert.equal(
    finalizeOsResult.status,
    200,
    `Finalização da OS falhou: ${JSON.stringify(finalizeOsResult.body)}`
  );

  assert.equal(
    finalizeOsResult.body?.status,
    "finalizado"
  );

  pass(
    "OS de teste é finalizada antes do arquivamento definitivo"
  );

  const dashboardBeforeArchive =
    await apiRequest(
      "/dashboard?period=all",
      {
        token: externalToken,
      }
    );

  assert.equal(
    dashboardBeforeArchive.status,
    200
  );

  assert.ok(
    dashboardBeforeArchive.body?.ultimas_os?.some(
      (item) =>
        Number(item.id) ===
        createdOsId
    ),
    "Dashboard não encontrou a OS finalizada antes do arquivamento."
  );

  pass(
    "Dashboard reconhece a OS finalizada antes de arquivar o cliente"
  );

  const secondArchiveReason =
    "Cliente inativo após encerramento do atendimento";

  const secondArchive =
    await apiRequest(
      `/clientes/${createdClientId}/archive`,
      {
        method: "POST",
        token: externalToken,
        body: {
          motivo:
            secondArchiveReason,
        },
      }
    );

  assert.equal(
    secondArchive.status,
    200,
    `Arquivamento com OS finalizada falhou: ${JSON.stringify(secondArchive.body)}`
  );

  pass(
    "OS finalizada não bloqueia arquivamento do cliente"
  );

  const osDetailAfterArchive =
    await apiRequest(
      `/os/${createdOsId}`,
      {
        token: externalToken,
      }
    );

  assert.equal(
    osDetailAfterArchive.status,
    200
  );

  assert.equal(
    Number(osDetailAfterArchive.body?.cliente_id),
    createdClientId
  );

  assert.equal(
    osDetailAfterArchive.body?.status,
    "finalizado"
  );

  pass(
    "Detalhe histórico da OS continua acessível com cliente arquivado"
  );

  const osListAfterArchive =
    await apiRequest(
      "/os?period=all&status=finalizado",
      {
        token: externalToken,
      }
    );

  assert.equal(
    osListAfterArchive.status,
    200
  );

  assert.ok(
    osListAfterArchive.body.some(
      (item) =>
        Number(item.id) ===
        createdOsId
    ),
    "OS histórica desapareceu da listagem após arquivar cliente."
  );

  pass(
    "Lista histórica de OS preserva atendimento do cliente arquivado"
  );

  const dashboardAfterArchive =
    await apiRequest(
      "/dashboard?period=all",
      {
        token: externalToken,
      }
    );

  assert.equal(
    dashboardAfterArchive.status,
    200
  );

  assert.deepEqual(
    dashboardAfterArchive.body?.cards,
    dashboardBeforeArchive.body?.cards,
    "Arquivar cliente alterou os cards históricos do Dashboard."
  );

  assert.deepEqual(
    dashboardAfterArchive.body?.por_status,
    dashboardBeforeArchive.body?.por_status,
    "Arquivar cliente alterou resultados históricos por status."
  );

  pass(
    "Arquivamento não altera resultados e faturamento históricos do Dashboard"
  );

  assert.ok(
    dashboardAfterArchive.body?.ultimas_os?.some(
      (item) =>
        Number(item.id) ===
        createdOsId
    ),
    "Dashboard deixou de exibir a OS após arquivamento do cliente."
  );

  pass(
    "Dashboard continua exibindo OS do cliente arquivado"
  );

  const lifecycleAudit =
    await pool.query(
      `
        SELECT
          action,
          entity_type,
          entity_id,
          actor_user_id,
          metadata
        FROM audit_logs
        WHERE company_id = $1
          AND entity_type = 'cliente'
          AND entity_id = $2
        ORDER BY id ASC
      `,
      [
        fixture.externalCompanyId,
        createdClientId,
      ]
    );

  assert.deepEqual(
    lifecycleAudit.rows.map(
      (row) => row.action
    ),
    [
      "CLIENT_ARCHIVED",
      "CLIENT_REACTIVATED",
      "CLIENT_ARCHIVED",
    ]
  );

  assert.equal(
    lifecycleAudit.rows[2].metadata?.reason,
    secondArchiveReason
  );

  pass(
    "Auditoria preserva sequência completa arquivar, reativar e arquivar"
  );

  const finalSnapshot =
    await getIsolationSnapshot();

  assert.deepEqual(
    finalSnapshot.primaryClient,
    initialSnapshot.primaryClient,
    "Cliente do Tenant A foi alterado durante a regressão."
  );

  assert.equal(
    finalSnapshot.externalClientCount,
    initialSnapshot.externalClientCount + 1,
    "Tenant B terminou com quantidade inesperada de clientes de teste."
  );

  pass(
    "Tenant A permaneceu íntegro e o estado final do Tenant B é o esperado"
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
          total: 28,
          passed: passedChecks,
          failed: 28 - passedChecks,
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
      of serverLogs.slice(-35)
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
