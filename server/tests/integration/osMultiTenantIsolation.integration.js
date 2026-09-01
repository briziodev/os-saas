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
  primaryClientId: null,
  externalClientId: null,
  primaryOsId: null,
  externalOsId: null,
  primaryPartId: null,
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
          `Tenant A isolamento ${suffix}`,
          `Tenant B isolamento ${suffix}`,
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
          ($5, $6, $3, $7, 'admin', true, now(), 1, now())
        RETURNING id, company_id
      `,
      [
        "Admin Tenant A",
        `admin.a.${suffix}@teste.local`,
        passwordHash,
        fixture.primaryCompanyId,

        "Admin Tenant B",
        `admin.b.${suffix}@teste.local`,
        fixture.externalCompanyId,
      ]
    );

    for (const user of users.rows) {
      fixture.userIds.push(user.id);

      if (
        Number(user.company_id) ===
        Number(fixture.primaryCompanyId)
      ) {
        fixture.primaryAdminId = user.id;
      }

      if (
        Number(user.company_id) ===
        Number(fixture.externalCompanyId)
      ) {
        fixture.externalAdminId = user.id;
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
        "Cliente Tenant A",
        `cliente.a.${suffix}@teste.local`,
        "5544999999991",
        fixture.primaryAdminId,
        fixture.primaryCompanyId,

        "Cliente Tenant B",
        `cliente.b.${suffix}@teste.local`,
        "5544999999992",
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

    const orders = await client.query(
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
            user_id,
            company_id
          )
        VALUES
          (
            $1,
            'AAA1A11',
            'Veículo Tenant A',
            'OS alvo para isolamento multi-tenant',
            100,
            50,
            150,
            'triagem',
            $2,
            $3
          ),
          (
            $4,
            'BBB2B22',
            'Veículo Tenant B',
            'OS própria do Tenant B',
            80,
            0,
            80,
            'triagem',
            $5,
            $6
          )
        RETURNING id, company_id
      `,
      [
        fixture.primaryClientId,
        fixture.primaryAdminId,
        fixture.primaryCompanyId,

        fixture.externalClientId,
        fixture.externalAdminId,
        fixture.externalCompanyId,
      ]
    );

    for (const item of orders.rows) {
      if (
        Number(item.company_id) ===
        Number(fixture.primaryCompanyId)
      ) {
        fixture.primaryOsId = item.id;
      }

      if (
        Number(item.company_id) ===
        Number(fixture.externalCompanyId)
      ) {
        fixture.externalOsId = item.id;
      }
    }

    const part = await client.query(
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
          ($1, $2, 'Peça Tenant A', 1, 50)
        RETURNING id
      `,
      [
        fixture.primaryOsId,
        fixture.primaryCompanyId,
      ]
    );

    fixture.primaryPartId =
      part.rows[0].id;

    await client.query(
      `
        INSERT INTO os_events
          (
            company_id,
            os_id,
            user_id,
            event_type,
            title,
            description,
            metadata
          )
        VALUES
          (
            $1,
            $2,
            $3,
            'os_created',
            'OS criada',
            'Evento de fixture para isolamento',
            $4::jsonb
          )
        RETURNING id
      `,
      [
        fixture.primaryCompanyId,
        fixture.primaryOsId,
        fixture.primaryAdminId,
        JSON.stringify({
          source: "multitenant_isolation_fixture",
        }),
      ]
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

async function cleanupFixtures() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (fixture.companyIds.length > 0) {
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
  const osResult = await pool.query(
    `
      SELECT
        id,
        company_id,
        cliente_id,
        problema_relatado,
        mao_obra,
        valor_pecas,
        valor_total,
        status,
        updated_at,
        closed_at
      FROM ordens_servico
      WHERE id = $1
        AND company_id = $2
    `,
    [
      fixture.primaryOsId,
      fixture.primaryCompanyId,
    ]
  );

  assert.equal(
    osResult.rowCount,
    1,
    "OS alvo do Tenant A não encontrada."
  );

  const partResult = await pool.query(
    `
      SELECT
        id,
        os_id,
        company_id,
        nome,
        quantidade,
        valor_unitario,
        valor_total
      FROM os_pecas
      WHERE id = $1
        AND os_id = $2
        AND company_id = $3
    `,
    [
      fixture.primaryPartId,
      fixture.primaryOsId,
      fixture.primaryCompanyId,
    ]
  );

  assert.equal(
    partResult.rowCount,
    1,
    "Peça alvo do Tenant A não encontrada."
  );

  const eventsResult = await pool.query(
    `
      SELECT
        id,
        company_id,
        os_id,
        user_id,
        event_type,
        title,
        description,
        metadata
      FROM os_events
      WHERE os_id = $1
        AND company_id = $2
      ORDER BY id
    `,
    [
      fixture.primaryOsId,
      fixture.primaryCompanyId,
    ]
  );

  const tenantBOrdersResult =
    await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM ordens_servico
        WHERE company_id = $1
      `,
      [fixture.externalCompanyId]
    );

  return {
    os: osResult.rows[0],
    part: partResult.rows[0],
    events: eventsResult.rows,
    tenantBOrderCount:
      tenantBOrdersResult.rows[0].total,
  };
}

async function runRegression() {
  const emails = {
    external:
      `admin.b.${suffix}@teste.local`,
  };

  const tokens = {
    external:
      await login(emails.external),
  };

  const initialSnapshot =
    await getIsolationSnapshot();

  const externalList =
    await apiRequest(
      "/os?period=all",
      {
        token: tokens.external,
      }
    );

  assert.equal(
    externalList.status,
    200,
    `GET /os do Tenant B retornou HTTP ${externalList.status}: ${JSON.stringify(externalList.body)}`
  );

  assert.ok(
    Array.isArray(externalList.body),
    "Resposta de GET /os deveria ser uma lista."
  );

  assert.ok(
    externalList.body.some(
      (item) =>
        Number(item.id) ===
        Number(fixture.externalOsId)
    ),
    "Tenant B não encontrou sua própria OS."
  );

  assert.ok(
    externalList.body.every(
      (item) =>
        Number(item.id) !==
        Number(fixture.primaryOsId)
    ),
    "Tenant B recebeu OS pertencente ao Tenant A."
  );

  pass(
    "Tenant B lista apenas suas próprias OS"
  );

  const ownOs =
    await apiRequest(
      `/os/${fixture.externalOsId}`,
      {
        token: tokens.external,
      }
    );

  assert.equal(
    ownOs.status,
    200,
    `GET da própria OS do Tenant B retornou HTTP ${ownOs.status}: ${JSON.stringify(ownOs.body)}`
  );

  assert.equal(
    Number(ownOs.body?.id),
    Number(fixture.externalOsId)
  );

  pass(
    "Tenant B acessa sua própria OS"
  );

  await expectHttp(
    "Tenant B não acessa GET da OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}`,
      {
        token: tokens.external,
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não altera OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}`,
      {
        method: "PUT",
        token: tokens.external,
        body: {
          problema_relatado:
            "Tentativa cruzada bloqueada",
        },
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não descarta OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/descartar`,
      {
        method: "POST",
        token: tokens.external,
        body: {
          motivo:
            "Tentativa cross-tenant de descarte bloqueada.",
        },
      }
    ),
    404
  );
  await expectHttp(
    "Tenant B não lista eventos da OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/events`,
      {
        token: tokens.external,
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não lista peças da OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/pecas`,
      {
        token: tokens.external,
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não adiciona peça na OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/pecas`,
      {
        method: "POST",
        token: tokens.external,
        body: {
          nome: "Peça indevida",
          quantidade: 1,
          valor_unitario: 25,
        },
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não altera peça da OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/pecas/${fixture.primaryPartId}`,
      {
        method: "PUT",
        token: tokens.external,
        body: {
          nome: "Peça alterada indevidamente",
          quantidade: 2,
          valor_unitario: 30,
        },
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não exclui peça da OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/pecas/${fixture.primaryPartId}`,
      {
        method: "DELETE",
        token: tokens.external,
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não gera orçamento da OS do Tenant A",
    apiRequest(
      `/os/${fixture.primaryOsId}/enviar-orcamento`,
      {
        method: "POST",
        token: tokens.external,
      }
    ),
    404
  );

  await expectHttp(
    "Tenant B não cria OS usando cliente do Tenant A",
    apiRequest(
      "/os",
      {
        method: "POST",
        token: tokens.external,
        body: {
          cliente_id:
            fixture.primaryClientId,
          problema_relatado:
            "Tentativa de usar cliente de outro tenant",
          mao_obra: 100,
          valor_pecas: 0,
          placa: "CCC3C33",
          modelo: "Veículo indevido",
        },
      }
    ),
    400
  );

  const finalSnapshot =
    await getIsolationSnapshot();

  assert.deepEqual(
    finalSnapshot,
    initialSnapshot,
    "Tentativas cross-tenant alteraram o estado das fixtures."
  );

  pass(
    "Tentativas cross-tenant não alteraram OS, peça, eventos ou contagem do Tenant B"
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
          total: 13,
          passed: passedChecks,
          failed: 13 - passedChecks,
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
