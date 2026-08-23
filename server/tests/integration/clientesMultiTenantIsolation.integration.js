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
          ($5, $6, $3, $7, 'admin', true, now(), 1, now())
        RETURNING id, company_id
      `,
      [
        "Admin Cliente Tenant A",
        `admin.cliente.a.${suffix}@teste.local`,
        passwordHash,
        fixture.primaryCompanyId,

        "Admin Cliente Tenant B",
        `admin.cliente.b.${suffix}@teste.local`,
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
    "Tenant B lista apenas clientes da própria empresa"
  );

  const createdResult =
    await apiRequest(
      "/clientes",
      {
        method: "POST",
        token: externalToken,
        body: {
          nome:
            "Cliente Criado Tenant B",
          email:
            `criado.b.${suffix}@teste.local`,
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
    Number(fixture.externalCompanyId),
    "Cliente criado recebeu company_id incorreto."
  );

  assert.equal(
    Number(createdResult.body?.user_id),
    Number(fixture.externalAdminId),
    "Cliente criado recebeu user_id incorreto."
  );

  pass(
    "Tenant B cria cliente automaticamente vinculado ao próprio tenant"
  );

  const ownUpdateResult =
    await apiRequest(
      `/clientes/${createdClientId}`,
      {
        method: "PUT",
        token: externalToken,
        body: {
          nome:
            "Cliente Atualizado Tenant B",
          email:
            `atualizado.b.${suffix}@teste.local`,
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
    Number(ownUpdateResult.body?.id),
    createdClientId
  );

  assert.equal(
    Number(ownUpdateResult.body?.company_id),
    Number(fixture.externalCompanyId)
  );

  assert.equal(
    ownUpdateResult.body?.nome,
    "Cliente Atualizado Tenant B"
  );

  pass(
    "Tenant B atualiza cliente da própria empresa"
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
    "Tenant B não exclui cliente do Tenant A",
    apiRequest(
      `/clientes/${fixture.primaryClientId}`,
      {
        method: "DELETE",
        token: externalToken,
      }
    ),
    404
  );

  const ownDeleteResult =
    await apiRequest(
      `/clientes/${createdClientId}`,
      {
        method: "DELETE",
        token: externalToken,
      }
    );

  assert.equal(
    ownDeleteResult.status,
    200,
    `DELETE do próprio cliente retornou HTTP ${ownDeleteResult.status}: ${JSON.stringify(ownDeleteResult.body)}`
  );

  assert.equal(
    Number(ownDeleteResult.body?.deleted?.id),
    createdClientId
  );

  assert.equal(
    Number(ownDeleteResult.body?.deleted?.company_id),
    Number(fixture.externalCompanyId)
  );

  pass(
    "Tenant B exclui cliente da própria empresa"
  );

  const finalSnapshot =
    await getIsolationSnapshot();

  assert.deepEqual(
    finalSnapshot,
    initialSnapshot,
    "Tentativas cross-tenant ou operações próprias deixaram estado inesperado."
  );

  pass(
    "Cliente do Tenant A permaneceu íntegro e Tenant B voltou à contagem inicial"
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
          total: 7,
          passed: passedChecks,
          failed: 7 - passedChecks,
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
