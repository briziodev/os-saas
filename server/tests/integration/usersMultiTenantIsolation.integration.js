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
  primaryTargetId: null,
  externalAdminId: null,
  externalTargetId: null,
  externalOperatorId: null,
  primaryTargetEmail: null,
  externalTargetOriginalEmail: null,
  externalOperatorEmail: null,
  externalAdminEmail: null,
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

  if (serverLogs.length > 150) {
    serverLogs.splice(
      0,
      serverLogs.length - 150
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
          `Tenant A users ${suffix}`,
          `Tenant B users ${suffix}`,
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

    fixture.primaryTargetEmail =
      `target.a.${suffix}@teste.local`;

    fixture.externalTargetOriginalEmail =
      `target.b.${suffix}@teste.local`;

    fixture.externalOperatorEmail =
      `operador.b.${suffix}@teste.local`;

    fixture.externalAdminEmail =
      `admin.b.${suffix}@teste.local`;

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
            password_changed_at,
            phone
          )
        VALUES
          ($1, $2, $3, $4, 'admin', true, now(), 1, now(), $5),
          ($6, $7, $3, $4, 'tecnico', true, now(), 1, now(), $8),
          ($9, $10, $3, $11, 'admin', true, now(), 1, now(), $12),
          ($13, $14, $3, $11, 'tecnico', true, now(), 1, now(), $15),
          ($16, $17, $3, $11, 'atendimento', true, now(), 1, now(), $18)
        RETURNING id, email, company_id, role
      `,
      [
        "Admin Tenant A",
        `admin.a.${suffix}@teste.local`,
        passwordHash,
        fixture.primaryCompanyId,
        "44999999901",

        "Alvo Tenant A",
        fixture.primaryTargetEmail,
        "44999999902",

        "Admin Tenant B",
        fixture.externalAdminEmail,
        fixture.externalCompanyId,
        "44999999903",

        "Alvo Tenant B",
        fixture.externalTargetOriginalEmail,
        "44999999904",

        "Operador Tenant B",
        fixture.externalOperatorEmail,
        "44999999905",
      ]
    );

    for (const user of users.rows) {
      fixture.userIds.push(user.id);

      const companyId =
        Number(user.company_id);

      if (
        companyId ===
        Number(fixture.primaryCompanyId) &&
        user.role === "admin"
      ) {
        fixture.primaryAdminId = user.id;
      }

      if (
        companyId ===
        Number(fixture.primaryCompanyId) &&
        user.role === "tecnico"
      ) {
        fixture.primaryTargetId = user.id;
      }

      if (
        companyId ===
        Number(fixture.externalCompanyId) &&
        user.role === "admin"
      ) {
        fixture.externalAdminId = user.id;
      }

      if (
        companyId ===
        Number(fixture.externalCompanyId) &&
        user.role === "tecnico"
      ) {
        fixture.externalTargetId = user.id;
      }

      if (
        companyId ===
        Number(fixture.externalCompanyId) &&
        user.role === "atendimento"
      ) {
        fixture.externalOperatorId = user.id;
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

async function getPrimaryTargetSnapshot() {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        email,
        phone,
        role,
        company_id,
        is_active,
        session_version,
        invite_token,
        invite_expires_at,
        activated_at
      FROM users
      WHERE id = $1
        AND company_id = $2
    `,
    [
      fixture.primaryTargetId,
      fixture.primaryCompanyId,
    ]
  );

  assert.equal(
    result.rowCount,
    1,
    "Usuário alvo do Tenant A não encontrado."
  );

  return result.rows[0];
}

async function getExternalTargetState() {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        email,
        phone,
        role,
        company_id,
        is_active,
        session_version
      FROM users
      WHERE id = $1
        AND company_id = $2
    `,
    [
      fixture.externalTargetId,
      fixture.externalCompanyId,
    ]
  );

  assert.equal(
    result.rowCount,
    1,
    "Usuário alvo do Tenant B não encontrado."
  );

  return result.rows[0];
}

async function runRegression() {
  const adminToken =
    await login(fixture.externalAdminEmail);

  const operatorToken =
    await login(fixture.externalOperatorEmail);

  const targetTokenBeforeRole =
    await login(
      fixture.externalTargetOriginalEmail
    );

  const primaryInitial =
    await getPrimaryTargetSnapshot();

  const listResult =
    await apiRequest(
      "/users",
      {
        token: adminToken,
      }
    );

  assert.equal(
    listResult.status,
    200,
    `GET /users retornou HTTP ${listResult.status}: ${JSON.stringify(listResult.body)}`
  );

  assert.ok(
    Array.isArray(listResult.body),
    "GET /users deveria retornar lista."
  );

  assert.ok(
    listResult.body.some(
      (item) =>
        Number(item.id) ===
        Number(fixture.externalTargetId)
    ),
    "Tenant B não recebeu seu usuário alvo."
  );

  assert.ok(
    listResult.body.every(
      (item) =>
        Number(item.company_id) ===
        Number(fixture.externalCompanyId)
    ),
    "Tenant B recebeu usuário de outro tenant."
  );

  assert.ok(
    listResult.body.every(
      (item) =>
        Number(item.id) !==
        Number(fixture.primaryTargetId)
    ),
    "Tenant B recebeu usuário alvo do Tenant A."
  );

  pass(
    "Admin do Tenant B lista apenas usuários da própria empresa"
  );

  await expectHttp(
    "Atendimento do Tenant B não acessa administração de usuários",
    apiRequest(
      "/users",
      {
        token: operatorToken,
      }
    ),
    403
  );

  const updatedEmail =
    `target.b.updated.${suffix}@teste.local`;

  const ownProfile =
    await apiRequest(
      `/users/${fixture.externalTargetId}/profile`,
      {
        method: "PATCH",
        token: adminToken,
        body: {
          name:
            "Alvo Tenant B Atualizado",
          email: updatedEmail,
          phone: "(44) 99999-9906",
        },
      }
    );

  assert.equal(
    ownProfile.status,
    200,
    `PATCH profile próprio retornou HTTP ${ownProfile.status}: ${JSON.stringify(ownProfile.body)}`
  );

  assert.equal(
    Number(ownProfile.body?.user?.id),
    Number(fixture.externalTargetId)
  );

  assert.equal(
    Number(ownProfile.body?.user?.company_id),
    Number(fixture.externalCompanyId)
  );

  assert.equal(
    ownProfile.body?.user?.email,
    updatedEmail
  );

  pass(
    "Admin do Tenant B atualiza perfil de usuário da própria empresa"
  );

  await expectHttp(
    "Admin do Tenant B não altera perfil de usuário do Tenant A",
    apiRequest(
      `/users/${fixture.primaryTargetId}/profile`,
      {
        method: "PATCH",
        token: adminToken,
        body: {
          name:
            "Tentativa Cross Tenant",
          email:
            `cross.profile.${suffix}@teste.local`,
          phone:
            "44999999907",
        },
      }
    ),
    404
  );

  const beforeRole =
    await getExternalTargetState();

  const ownRole =
    await apiRequest(
      `/users/${fixture.externalTargetId}/role`,
      {
        method: "PATCH",
        token: adminToken,
        body: {
          role: "atendimento",
        },
      }
    );

  assert.equal(
    ownRole.status,
    200,
    `PATCH role próprio retornou HTTP ${ownRole.status}: ${JSON.stringify(ownRole.body)}`
  );

  assert.equal(
    ownRole.body?.sessions_revoked,
    true
  );

  assert.equal(
    ownRole.body?.user?.role,
    "atendimento"
  );

  const afterRole =
    await getExternalTargetState();

  assert.equal(
    afterRole.role,
    "atendimento"
  );

  assert.equal(
    Number(afterRole.session_version),
    Number(beforeRole.session_version) + 1
  );

  pass(
    "Admin do Tenant B altera perfil funcional dentro do próprio tenant e incrementa session_version"
  );

  await expectHttp(
    "Token anterior do usuário é revogado após troca de perfil",
    apiRequest(
      "/auth/me",
      {
        token: targetTokenBeforeRole,
      }
    ),
    401
  );

  await expectHttp(
    "Admin do Tenant B não altera perfil funcional de usuário do Tenant A",
    apiRequest(
      `/users/${fixture.primaryTargetId}/role`,
      {
        method: "PATCH",
        token: adminToken,
        body: {
          role: "atendimento",
        },
      }
    ),
    404
  );

  await expectHttp(
    "Admin do Tenant B não altera status de usuário do Tenant A",
    apiRequest(
      `/users/${fixture.primaryTargetId}/toggle-active`,
      {
        method: "PATCH",
        token: adminToken,
      }
    ),
    404
  );

  await expectHttp(
    "Admin do Tenant B não reenvia convite para usuário do Tenant A",
    apiRequest(
      `/users/${fixture.primaryTargetId}/resend-invite`,
      {
        method: "POST",
        token: adminToken,
      }
    ),
    404
  );

  const targetTokenAfterRole =
    await login(updatedEmail);

  const beforeToggle =
    await getExternalTargetState();

  const ownToggle =
    await apiRequest(
      `/users/${fixture.externalTargetId}/toggle-active`,
      {
        method: "PATCH",
        token: adminToken,
      }
    );

  assert.equal(
    ownToggle.status,
    200,
    `PATCH toggle próprio retornou HTTP ${ownToggle.status}: ${JSON.stringify(ownToggle.body)}`
  );

  assert.equal(
    ownToggle.body?.sessions_revoked,
    true
  );

  assert.equal(
    ownToggle.body?.user?.is_active,
    false
  );

  const afterToggle =
    await getExternalTargetState();

  assert.equal(
    afterToggle.is_active,
    false
  );

  assert.equal(
    Number(afterToggle.session_version),
    Number(beforeToggle.session_version) + 1
  );

  pass(
    "Admin do Tenant B desativa usuário da própria empresa e incrementa session_version"
  );

  const inactiveTokenResult =
    await apiRequest(
      "/auth/me",
      {
        token: targetTokenAfterRole,
      }
    );

  assert.equal(
    inactiveTokenResult.status,
    403,
    [
      "Token anterior do usuário após desativação:",
      "HTTP esperado 403,",
      `recebido ${inactiveTokenResult.status}.`,
      `Resposta: ${JSON.stringify(inactiveTokenResult.body)}`,
    ].join(" ")
  );

  assert.equal(
    inactiveTokenResult.body?.code,
    "USER_INACTIVE",
    "Usuário desativado deveria ser bloqueado com code USER_INACTIVE."
  );

  pass(
    "Token anterior do usuário é bloqueado como USER_INACTIVE após desativação"
  );

  const primaryFinal =
    await getPrimaryTargetSnapshot();

  assert.deepEqual(
    primaryFinal,
    primaryInitial,
    "Tentativas cross-tenant alteraram o usuário do Tenant A."
  );

  pass(
    "Usuário do Tenant A permaneceu íntegro após todas as tentativas cross-tenant"
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
          total: 12,
          passed: passedChecks,
          failed: 12 - passedChecks,
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
      of serverLogs.slice(-40)
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
