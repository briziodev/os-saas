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
  externalTecnicoId: null,
  primaryClientId: null,
  externalClientId: null,
  primaryOsIds: [],
  externalOsIds: [],
  primaryAdminEmail: null,
  externalAdminEmail: null,
  externalAtendimentoEmail: null,
  externalTecnicoEmail: null,
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
          `Tenant A dashboard ${suffix}`,
          `Tenant B dashboard ${suffix}`,
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

    fixture.primaryAdminEmail =
      `dashboard.admin.a.${suffix}@teste.local`;

    fixture.externalAdminEmail =
      `dashboard.admin.b.${suffix}@teste.local`;

    fixture.externalAtendimentoEmail =
      `dashboard.atendimento.b.${suffix}@teste.local`;

    fixture.externalTecnicoEmail =
      `dashboard.tecnico.b.${suffix}@teste.local`;

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
          ($8, $9, $3, $7, 'atendimento', true, now(), 1, now()),
          ($10, $11, $3, $7, 'tecnico', true, now(), 1, now())
        RETURNING id, email, role, company_id
      `,
      [
        "Admin Tenant A Dashboard",
        fixture.primaryAdminEmail,
        passwordHash,
        fixture.primaryCompanyId,

        "Admin Tenant B Dashboard",
        fixture.externalAdminEmail,
        fixture.externalCompanyId,

        "Atendimento Tenant B Dashboard",
        fixture.externalAtendimentoEmail,

        "Tecnico Tenant B Dashboard",
        fixture.externalTecnicoEmail,
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
        Number(fixture.externalCompanyId) &&
        user.role === "admin"
      ) {
        fixture.externalAdminId = user.id;
      }

      if (
        companyId ===
        Number(fixture.externalCompanyId) &&
        user.role === "atendimento"
      ) {
        fixture.externalAtendimentoId = user.id;
      }

      if (
        companyId ===
        Number(fixture.externalCompanyId) &&
        user.role === "tecnico"
      ) {
        fixture.externalTecnicoId = user.id;
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
        "Cliente Tenant A Dashboard",
        `dashboard.cliente.a.${suffix}@teste.local`,
        "5544999999911",
        fixture.primaryAdminId,
        fixture.primaryCompanyId,

        "Cliente Tenant B Dashboard",
        `dashboard.cliente.b.${suffix}@teste.local`,
        "5544999999922",
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

    const primaryOrders = await client.query(
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
            'AAA1A11',
            'Veiculo A Execucao',
            'Nao pode aparecer no dashboard B',
            9000,
            999,
            9999,
            'em_execucao',
            NULL,
            $2,
            $3
          ),
          (
            $1,
            'AAA2A22',
            'Veiculo A Encerrado',
            'Nao pode contaminar faturamento B',
            8000,
            888,
            8888,
            'encerrado',
            now(),
            $2,
            $3
          )
        RETURNING id
      `,
      [
        fixture.primaryClientId,
        fixture.primaryAdminId,
        fixture.primaryCompanyId,
      ]
    );

    fixture.primaryOsIds.push(
      ...primaryOrders.rows.map((row) => row.id)
    );

    const externalOrders = await client.query(
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
            'BBB1B11',
            'Veiculo B Triagem',
            'Fixture dashboard B',
            100,
            0,
            100,
            'triagem',
            NULL,
            $2,
            $3
          ),
          (
            $1,
            'BBB2B22',
            'Veiculo B Aprovacao',
            'Fixture dashboard B',
            200,
            0,
            200,
            'aguardando_aprovacao',
            NULL,
            $2,
            $3
          ),
          (
            $1,
            'BBB3B33',
            'Veiculo B Execucao',
            'Fixture dashboard B',
            300,
            0,
            300,
            'em_execucao',
            NULL,
            $2,
            $3
          ),
          (
            $1,
            'BBB4B44',
            'Veiculo B Encerrado',
            'Fixture dashboard B',
            400,
            0,
            400,
            'encerrado',
            now(),
            $2,
            $3
          )
        RETURNING id
      `,
      [
        fixture.externalClientId,
        fixture.externalAdminId,
        fixture.externalCompanyId,
      ]
    );

    fixture.externalOsIds.push(
      ...externalOrders.rows.map((row) => row.id)
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

async function getFixtureSnapshot() {
  const result = await pool.query(
    `
      SELECT
        company_id,
        status::text AS status,
        valor_total::numeric AS valor_total,
        closed_at IS NOT NULL AS is_closed,
        COUNT(*) OVER (
          PARTITION BY company_id
        )::int AS tenant_count
      FROM ordens_servico
      WHERE company_id = ANY($1::int[])
      ORDER BY company_id, id
    `,
    [fixture.companyIds]
  );

  return result.rows.map((row) => ({
    company_id: Number(row.company_id),
    status: row.status,
    valor_total: Number(row.valor_total),
    is_closed: row.is_closed,
    tenant_count: Number(row.tenant_count),
  }));
}

function assertDashboardTenantB(body) {
  assert.equal(
    Number(body?.company_id),
    Number(fixture.externalCompanyId),
    "Dashboard retornou company_id incorreto."
  );

  assert.equal(
    body?.period?.key,
    "all",
    "Dashboard deveria usar period=all."
  );
}

async function runRegression() {
  const adminToken =
    await login(fixture.externalAdminEmail);

  const atendimentoToken =
    await login(
      fixture.externalAtendimentoEmail
    );

  const tecnicoToken =
    await login(fixture.externalTecnicoEmail);

  const initialSnapshot =
    await getFixtureSnapshot();

  const adminResult =
    await apiRequest(
      "/dashboard?period=all",
      {
        token: adminToken,
      }
    );

  assert.equal(
    adminResult.status,
    200,
    `Dashboard admin retornou HTTP ${adminResult.status}: ${JSON.stringify(adminResult.body)}`
  );

  assertDashboardTenantB(adminResult.body);

  pass(
    "Admin do Tenant B recebe dashboard vinculado ao próprio company_id"
  );

  assert.deepEqual(
    {
      abertas_periodo:
        Number(
          adminResult.body?.cards?.abertas_periodo
        ),
      em_andamento:
        Number(
          adminResult.body?.cards?.em_andamento
        ),
      orcamentos_pendentes:
        Number(
          adminResult.body?.cards?.orcamentos_pendentes
        ),
      finalizados_no_periodo:
        Number(
          adminResult.body?.cards?.finalizados_no_periodo
        ),
      faturamento_periodo:
        Number(
          adminResult.body?.cards?.faturamento_periodo
        ),
    },
    {
      abertas_periodo: 4,
      em_andamento: 1,
      orcamentos_pendentes: 1,
      finalizados_no_periodo: 1,
      faturamento_periodo: 400,
    },
    "Cards do Tenant B foram contaminados por outro tenant."
  );

  pass(
    "Cards e faturamento do admin do Tenant B não somam dados do Tenant A"
  );

  const statusMap = new Map(
    (adminResult.body?.por_status || [])
      .map((row) => [
        row.status,
        Number(row.total),
      ])
  );

  assert.deepEqual(
    Object.fromEntries(statusMap),
    {
      aguardando_aprovacao: 1,
      em_execucao: 1,
      encerrado: 1,
      triagem: 1,
    },
    "Distribuição por status do Tenant B está incorreta."
  );

  pass(
    "Distribuição por status do Dashboard permanece isolada por tenant"
  );

  const notificationItems =
    adminResult.body?.notifications?.items || [];

  assert.equal(
    Number(
      adminResult.body?.notifications?.total
    ),
    3
  );

  assert.deepEqual(
    notificationItems.map((item) => ({
      key: item.key,
      count: Number(item.count),
      href: item.href,
    })),
    [
      {
        key: "triagem",
        count: 1,
        href:
          "/os?period=all&status=triagem",
      },
      {
        key: "aguardando_aprovacao",
        count: 1,
        href:
          "/os?period=all&status=aguardando_aprovacao",
      },
      {
        key: "em_execucao",
        count: 1,
        href:
          "/os?period=all&status=em_execucao",
      },
    ]
  );

  pass(
    "Notificações do Dashboard refletem somente ações do Tenant B"
  );

  const latest =
    adminResult.body?.ultimas_os || [];

  assert.equal(
    latest.length,
    4,
    "ultimas_os deveria conter as 4 OS do Tenant B."
  );

  const externalIds =
    new Set(
      fixture.externalOsIds.map(Number)
    );

  for (const os of latest) {
    assert.ok(
      externalIds.has(Number(os.id)),
      `ultimas_os vazou OS externa: ${os.id}`
    );

    assert.equal(
      os.cliente_nome,
      "Cliente Tenant B Dashboard"
    );
  }

  const returnedTotals =
    latest
      .map((os) => Number(os.valor_total))
      .sort((a, b) => a - b);

  assert.deepEqual(
    returnedTotals,
    [100, 200, 300, 400]
  );

  pass(
    "Lista de últimas OS do Dashboard não expõe IDs, clientes ou valores do Tenant A"
  );

  const atendimentoResult =
    await apiRequest(
      "/dashboard?period=all",
      {
        token: atendimentoToken,
      }
    );

  assert.equal(
    atendimentoResult.status,
    200,
    `Dashboard atendimento retornou HTTP ${atendimentoResult.status}: ${JSON.stringify(atendimentoResult.body)}`
  );

  assertDashboardTenantB(
    atendimentoResult.body
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      atendimentoResult.body?.cards || {},
      "faturamento_periodo"
    ),
    false,
    "Atendimento recebeu faturamento agregado."
  );

  assert.equal(
    Number(
      atendimentoResult.body?.cards?.abertas_periodo
    ),
    4
  );

  pass(
    "Atendimento do Tenant B acessa dados operacionais sem faturamento agregado"
  );

  const tecnicoResult =
    await apiRequest(
      "/dashboard?period=all",
      {
        token: tecnicoToken,
      }
    );

  assert.equal(
    tecnicoResult.status,
    403,
    `Técnico deveria receber 403 no Dashboard, recebeu ${tecnicoResult.status}.`
  );

  pass(
    "Técnico do Tenant B não acessa Dashboard"
  );

  const finalSnapshot =
    await getFixtureSnapshot();

  assert.deepEqual(
    finalSnapshot,
    initialSnapshot,
    "GET /dashboard alterou fixtures do teste."
  );

  pass(
    "Consultas do Dashboard são somente leitura e preservam fixtures"
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
          total: 8,
          passed: passedChecks,
          failed: 8 - passedChecks,
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
