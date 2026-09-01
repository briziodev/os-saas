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
const { BCRYPT_ROUNDS } = require("../../utils/passwordPolicy");
const { assertSafeIntegrationDatabase } = require("../helpers/integrationDbGuard");

const TEST_PASSWORD = "TesteSeguro#2026";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

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
};

const tokens = {};
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
        ) || "nao informado",
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
  if (pool) return pool;
  pool = require("../../db");
  return pool;
}

function pass(name) {
  passedChecks += 1;
  console.log(`[PASS] ${name}`);
}

async function expectHttp(name, requestPromise, expectedStatus) {
  const result = await requestPromise;

  assert.equal(
    result.status,
    expectedStatus,
    `${name}: HTTP esperado ${expectedStatus}, recebido ${result.status}. Resposta: ${JSON.stringify(result.body)}`
  );

  pass(name);
  return result;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.once("error", reject);

    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function retainServerLog(chunk, stream) {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean);

  for (const line of lines) {
    serverLogs.push({ stream, line });
  }

  if (serverLogs.length > 120) {
    serverLogs.splice(0, serverLogs.length - 120);
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
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  backendProcess.stdout.on("data", (chunk) =>
    retainServerLog(chunk, "stdout")
  );

  backendProcess.stderr.on("data", (chunk) =>
    retainServerLog(chunk, "stderr")
  );

  for (let attempt = 1; attempt <= 50; attempt += 1) {
    if (backendProcess.exitCode !== null) {
      throw new Error("Backend encerrou antes de iniciar.");
    }

    try {
      const response = await fetch(`${baseUrl}/ready`, {
        signal: AbortSignal.timeout(2_000),
      });

      const body = await response.json();

      if (
        response.status === 200 &&
        body.status === "ready" &&
        body.schema === "compatible"
      ) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Backend temporario nao ficou ready.");
}

async function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) {
    return;
  }

  backendProcess.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) => backendProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
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
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

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
  const result = await apiRequest("/auth/login", {
    method: "POST",
    body: {
      email,
      password: TEST_PASSWORD,
    },
  });

  assert.equal(
    result.status,
    200,
    `Login falhou para ${email}: ${JSON.stringify(result.body)}`
  );

  assert.equal(
    typeof result.body?.token,
    "string",
    `Token ausente para ${email}.`
  );

  return result.body.token;
}

async function createFixtures() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const companies = await client.query(
      `
        INSERT INTO companies (name)
        VALUES ($1), ($2)
        RETURNING id, name
      `,
      [
        `Safe Discard ${suffix}`,
        `Safe Discard Externo ${suffix}`,
      ]
    );

    fixture.primaryCompanyId = companies.rows[0].id;
    fixture.externalCompanyId = companies.rows[1].id;

    fixture.companyIds.push(
      fixture.primaryCompanyId,
      fixture.externalCompanyId
    );

    const passwordHash = await bcrypt.hash(
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
        "Admin Safe Discard",
        `admin.safe.${suffix}@teste.local`,
        passwordHash,
        fixture.primaryCompanyId,

        "Atendimento Safe Discard",
        `atendimento.safe.${suffix}@teste.local`,

        "Tecnico Safe Discard",
        `tecnico.safe.${suffix}@teste.local`,

        "Admin Externo Safe Discard",
        `externo.safe.${suffix}@teste.local`,
        fixture.externalCompanyId,
      ]
    );

    for (const user of users.rows) {
      fixture.userIds.push(user.id);

      if (
        Number(user.company_id) === Number(fixture.primaryCompanyId) &&
        user.role === "admin"
      ) {
        fixture.adminId = user.id;
      }

      if (
        Number(user.company_id) === Number(fixture.primaryCompanyId) &&
        user.role === "atendimento"
      ) {
        fixture.atendimentoId = user.id;
      }

      if (
        Number(user.company_id) === Number(fixture.primaryCompanyId) &&
        user.role === "tecnico"
      ) {
        fixture.tecnicoId = user.id;
      }

      if (
        Number(user.company_id) === Number(fixture.externalCompanyId) &&
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
        "Cliente Safe Discard",
        `cliente.safe.${suffix}@teste.local`,
        "5544999999999",
        fixture.adminId,
        fixture.primaryCompanyId,
      ]
    );

    fixture.clienteId = cliente.rows[0].id;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeAuditFailureTrigger() {
  if (!pool) return;

  await pool.query(
    `
      DROP TRIGGER IF EXISTS
        test_block_safe_discard_audit_trigger
      ON audit_logs
    `
  ).catch(() => {});

  await pool.query(
    `
      DROP FUNCTION IF EXISTS
        public.test_block_safe_discard_audit()
    `
  ).catch(() => {});
}

async function cleanupFixtures() {
  await removeAuditFailureTrigger();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (fixture.companyIds.length > 0) {
      await client.query(
        `DELETE FROM audit_logs WHERE company_id = ANY($1::int[])`,
        [fixture.companyIds]
      );

      await client.query(
        `DELETE FROM os_events WHERE company_id = ANY($1::int[])`,
        [fixture.companyIds]
      );

      await client.query(
        `DELETE FROM os_pecas WHERE company_id = ANY($1::int[])`,
        [fixture.companyIds]
      );

      await client.query(
        `DELETE FROM ordens_servico WHERE company_id = ANY($1::int[])`,
        [fixture.companyIds]
      );

      await client.query(
        `DELETE FROM clientes WHERE company_id = ANY($1::int[])`,
        [fixture.companyIds]
      );
    }

    if (fixture.userIds.length > 0) {
      await client.query(
        `DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])`,
        [fixture.userIds]
      );

      await client.query(
        `DELETE FROM users WHERE id = ANY($1::int[])`,
        [fixture.userIds]
      );
    }

    if (fixture.companyIds.length > 0) {
      await client.query(
        `DELETE FROM companies WHERE id = ANY($1::int[])`,
        [fixture.companyIds]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createOS(
  token,
  label,
  {
    maoObra = 0,
    valorPecas = 0,
  } = {}
) {
  const result = await expectHttp(
    `Criar OS: ${label}`,
    apiRequest("/os", {
      method: "POST",
      token,
      body: {
        cliente_id: fixture.clienteId,
        problema_relatado: `Teste safe discard ${label}`,
        mao_obra: maoObra,
        valor_pecas: valorPecas,
        placa: "TST1A23",
        modelo: "Veiculo de teste",
      },
    }),
    201
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.body || {},
      "discard_locked_at"
    ),
    false,
    "Campo interno discard_locked_at vazou no create."
  );

  return Number(result.body.id);
}

async function getOSRow(osId) {
  const result = await pool.query(
    `
      SELECT
        id,
        status::text AS status,
        discard_locked_at
      FROM ordens_servico
      WHERE id = $1
        AND company_id = $2
    `,
    [
      osId,
      fixture.primaryCompanyId,
    ]
  );

  return result.rows[0] || null;
}

async function getDetail(osId, token) {
  const result = await apiRequest(`/os/${osId}`, {
    token,
  });

  assert.equal(
    result.status,
    200,
    `GET detalhe falhou: ${JSON.stringify(result.body)}`
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.body || {},
      "discard_locked_at"
    ),
    false,
    "Campo interno discard_locked_at vazou no detalhe."
  );

  return result.body;
}

async function assertDiscardCapability(
  name,
  osId,
  token,
  expected
) {
  const detail = await getDetail(osId, token);

  assert.equal(
    detail.capabilities?.can_discard,
    expected,
    `${name}: capability inesperada.`
  );

  pass(name);
}

async function assertOSExists(osId, expected = true) {
  const row = await getOSRow(osId);

  assert.equal(
    Boolean(row),
    expected,
    `Existencia inesperada da OS ${osId}.`
  );

  return row;
}

async function getDeleteAudit(osId) {
  const result = await pool.query(
    `
      SELECT
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
      FROM audit_logs
      WHERE company_id = $1
        AND action = 'OS_DELETED'
        AND entity_id = $2
      ORDER BY id DESC
    `,
    [
      fixture.primaryCompanyId,
      osId,
    ]
  );

  return result.rows;
}

async function installAuditFailureTrigger() {
  await removeAuditFailureTrigger();

  await pool.query(
    `
      CREATE FUNCTION
        public.test_block_safe_discard_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF
          NEW.action = 'OS_DELETED'
          AND
          NEW.metadata->>'source' = 'safe_discard'
        THEN
          RAISE EXCEPTION
            'forced safe discard audit failure';
        END IF;

        RETURN NEW;
      END;
      $$
    `
  );

  await pool.query(
    `
      CREATE TRIGGER
        test_block_safe_discard_audit_trigger
      BEFORE INSERT
      ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION
        public.test_block_safe_discard_audit()
    `
  );
}

async function runRegression() {
  const emails = {
    admin: `admin.safe.${suffix}@teste.local`,
    atendimento: `atendimento.safe.${suffix}@teste.local`,
    tecnico: `tecnico.safe.${suffix}@teste.local`,
    externalAdmin: `externo.safe.${suffix}@teste.local`,
  };

  tokens.admin = await login(emails.admin);
  tokens.atendimento = await login(emails.atendimento);
  tokens.tecnico = await login(emails.tecnico);
  tokens.externalAdmin = await login(emails.externalAdmin);

  const firstOS = await createOS(
    tokens.admin,
    "capability inicial"
  );

  const firstRow = await assertOSExists(firstOS);

  assert.equal(
    firstRow.discard_locked_at,
    null
  );

  pass(
    "Nova OS criada pela aplicacao nasce com discard_locked_at NULL"
  );

  await assertDiscardCapability(
    "Admin recebe can_discard=true em OS nova",
    firstOS,
    tokens.admin,
    true
  );

  await assertDiscardCapability(
    "Atendimento recebe can_discard=true em OS nova",
    firstOS,
    tokens.atendimento,
    true
  );

  await assertDiscardCapability(
    "Tecnico recebe can_discard=false",
    firstOS,
    tokens.tecnico,
    false
  );

  await expectHttp(
    "Motivo ausente e rejeitado",
    apiRequest(`/os/${firstOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {},
    }),
    400
  );

  await expectHttp(
    "Motivo curto e rejeitado",
    apiRequest(`/os/${firstOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo: "Curto",
      },
    }),
    400
  );

  await expectHttp(
    "Tecnico nao pode descartar",
    apiRequest(`/os/${firstOS}/descartar`, {
      method: "POST",
      token: tokens.tecnico,
      body: {
        motivo: "OS cadastrada para o cliente errado.",
      },
    }),
    403
  );

  await expectHttp(
    "Outro tenant recebe 404 ao tentar descartar",
    apiRequest(`/os/${firstOS}/descartar`, {
      method: "POST",
      token: tokens.externalAdmin,
      body: {
        motivo: "OS cadastrada para o cliente errado.",
      },
    }),
    404
  );

  const legacyResult = await expectHttp(
    "DELETE legado de OS retorna 410",
    apiRequest(`/os/${firstOS}`, {
      method: "DELETE",
      token: tokens.admin,
    }),
    410
  );

  assert.equal(
    legacyResult.body?.code,
    "OS_DELETE_LEGACY_ENDPOINT_GONE"
  );

  await assertOSExists(firstOS, true);

  pass("DELETE legado 410 preserva a OS");

  const atendimentoReason =
    "Cliente selecionado incorretamente na abertura da OS.";

  const discardByAtendimento = await expectHttp(
    "Atendimento descarta OS elegivel",
    apiRequest(`/os/${firstOS}/descartar`, {
      method: "POST",
      token: tokens.atendimento,
      body: {
        motivo: atendimentoReason,
      },
    }),
    200
  );

  assert.equal(
    Number(discardByAtendimento.body?.deleted?.id),
    firstOS
  );

  await assertOSExists(firstOS, false);

  const atendimentoAudit = await getDeleteAudit(firstOS);

  assert.equal(
    atendimentoAudit.length,
    1
  );

  assert.equal(
    atendimentoAudit[0].actor_role,
    "atendimento"
  );

  assert.equal(
    atendimentoAudit[0].metadata?.source,
    "safe_discard"
  );

  assert.equal(
    atendimentoAudit[0].metadata?.reason,
    atendimentoReason
  );

  pass(
    "Hard delete seguro preserva audit_logs com source e motivo"
  );

  const adminOS = await createOS(
    tokens.admin,
    "descarte admin"
  );

  await expectHttp(
    "Admin descarta OS elegivel",
    apiRequest(`/os/${adminOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "OS duplicada durante o atendimento inicial.",
      },
    }),
    200
  );

  await assertOSExists(adminOS, false);
  pass("OS descartada pelo Admin foi removida");

  const cancelledOS = await createOS(
    tokens.admin,
    "cancelamento direto"
  );

  await expectHttp(
    "Cancelamento direto triagem para cancelado",
    apiRequest(`/os/${cancelledOS}`, {
      method: "PUT",
      token: tokens.admin,
      body: {
        status: "cancelado",
      },
    }),
    200
  );

  await assertDiscardCapability(
    "Cancelamento direto continua descartavel",
    cancelledOS,
    tokens.admin,
    true
  );

  await expectHttp(
    "Admin descarta OS cancelada diretamente",
    apiRequest(`/os/${cancelledOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "OS aberta para cliente incorreto e cancelada imediatamente.",
      },
    }),
    200
  );

  const progressedOS = await createOS(
    tokens.admin,
    "progresso irreversivel"
  );

  await expectHttp(
    "OS avanca para em_analise",
    apiRequest(`/os/${progressedOS}`, {
      method: "PUT",
      token: tokens.admin,
      body: {
        status: "em_analise",
      },
    }),
    200
  );

  await expectHttp(
    "OS retorna para triagem sem destravar descarte",
    apiRequest(`/os/${progressedOS}`, {
      method: "PUT",
      token: tokens.admin,
      body: {
        status: "triagem",
      },
    }),
    200
  );

  const progressedRow =
    await assertOSExists(progressedOS);

  assert.ok(
    progressedRow.discard_locked_at
  );

  await assertDiscardCapability(
    "OS que ja progrediu permanece can_discard=false",
    progressedOS,
    tokens.admin,
    false
  );

  const progressedDiscard = await expectHttp(
    "Descarte de OS que ja progrediu e bloqueado",
    apiRequest(`/os/${progressedOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Tentativa de apagar historico operacional.",
      },
    }),
    409
  );

  assert.equal(
    progressedDiscard.body?.code,
    "OS_DISCARD_NOT_ALLOWED"
  );

  const correctionOS = await createOS(
    tokens.atendimento,
    "correcao administrativa"
  );

  await expectHttp(
    "Atendimento corrige descricao modelo e placa",
    apiRequest(`/os/${correctionOS}`, {
      method: "PUT",
      token: tokens.atendimento,
      body: {
        problema_relatado:
          "Ruido na roda dianteira corrigido no cadastro.",
        modelo: "Modelo corrigido",
        placa: "ABC1D23",
      },
    }),
    200
  );

  await assertDiscardCapability(
    "Correcao administrativa inicial nao bloqueia descarte",
    correctionOS,
    tokens.atendimento,
    true
  );

  await expectHttp(
    "Atendimento descarta apos simples correcao inicial",
    apiRequest(`/os/${correctionOS}/descartar`, {
      method: "POST",
      token: tokens.atendimento,
      body: {
        motivo:
          "Mesmo apos a correcao foi constatado cliente incorreto.",
      },
    }),
    200
  );

  const financialOS = await createOS(
    tokens.admin,
    "financeiro"
  );

  await expectHttp(
    "Alteracao de mao de obra",
    apiRequest(`/os/${financialOS}`, {
      method: "PUT",
      token: tokens.admin,
      body: {
        mao_obra: 150,
      },
    }),
    200
  );

  await assertDiscardCapability(
    "Alteracao financeira bloqueia descarte",
    financialOS,
    tokens.admin,
    false
  );

  await expectHttp(
    "Descarte apos alteracao financeira recebe 409",
    apiRequest(`/os/${financialOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Tentativa indevida apos alteracao financeira.",
      },
    }),
    409
  );

  const technicianOS = await createOS(
    tokens.admin,
    "atividade tecnica"
  );

  await expectHttp(
    "Tecnico registra atualizacao significativa",
    apiRequest(`/os/${technicianOS}`, {
      method: "PUT",
      token: tokens.tecnico,
      body: {
        problema_relatado:
          "Tecnico confirmou ruido no rolamento dianteiro.",
      },
    }),
    200
  );

  await assertDiscardCapability(
    "Atividade tecnica bloqueia descarte",
    technicianOS,
    tokens.admin,
    false
  );

  const partsOS = await createOS(
    tokens.admin,
    "pecas"
  );

  const partResult = await expectHttp(
    "Adicionar peca ativa lock",
    apiRequest(`/os/${partsOS}/pecas`, {
      method: "POST",
      token: tokens.admin,
      body: {
        nome: "Rolamento teste",
        quantidade: 1,
        valor_unitario: 90,
      },
    }),
    201
  );

  const partId = Number(partResult.body.id);

  await expectHttp(
    "Remover peca nao remove lock historico",
    apiRequest(`/os/${partsOS}/pecas/${partId}`, {
      method: "DELETE",
      token: tokens.admin,
    }),
    200
  );

  await assertDiscardCapability(
    "OS com historico de peca permanece bloqueada",
    partsOS,
    tokens.admin,
    false
  );

  const budgetOS = await createOS(
    tokens.admin,
    "orcamento"
  );

  await expectHttp(
    "Preparar orcamento ativa lock",
    apiRequest(`/os/${budgetOS}/enviar-orcamento`, {
      method: "POST",
      token: tokens.admin,
    }),
    200
  );

  await assertDiscardCapability(
    "OS com orcamento preparado nao pode ser descartada",
    budgetOS,
    tokens.admin,
    false
  );

  const reopenOS = await createOS(
    tokens.admin,
    "reabertura"
  );

  await expectHttp(
    "Cancelar OS antes da reabertura",
    apiRequest(`/os/${reopenOS}`, {
      method: "PUT",
      token: tokens.admin,
      body: {
        status: "cancelado",
      },
    }),
    200
  );

  await assertDiscardCapability(
    "OS cancelada diretamente ainda esta elegivel antes de reabrir",
    reopenOS,
    tokens.admin,
    true
  );

  await expectHttp(
    "Reabrir OS cancelada",
    apiRequest(`/os/${reopenOS}/reabrir`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Cliente confirmou retomada formal do diagnostico.",
      },
    }),
    200
  );

  await assertDiscardCapability(
    "Reabertura ativa bloqueio permanente",
    reopenOS,
    tokens.admin,
    false
  );

  const legacyInsert = await pool.query(
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
        ($1, 'LEG1A23', 'Legado', $2, 0, 0, 0, 'triagem', $3, $4)
      RETURNING
        id,
        discard_locked_at
    `,
    [
      fixture.clienteId,
      "Registro legado protegido pelo default fail-closed",
      fixture.adminId,
      fixture.primaryCompanyId,
    ]
  );

  const legacyOS = Number(legacyInsert.rows[0].id);

  assert.ok(
    legacyInsert.rows[0].discard_locked_at
  );

  pass(
    "Insert legado sem campo explicito recebe lock por DEFAULT now()"
  );

  await assertDiscardCapability(
    "OS legada protegida nunca aparece como descartavel",
    legacyOS,
    tokens.admin,
    false
  );

  await expectHttp(
    "Endpoint recusa hard delete de OS legada",
    apiRequest(`/os/${legacyOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Tentativa de descartar registro legado protegido.",
      },
    }),
    409
  );

  const unknownEventOS = await createOS(
    tokens.admin,
    "evento desconhecido"
  );

  await pool.query(
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
        ($1, $2, $3, 'diagnostic_started', 'Diagnostico iniciado', NULL, '{}'::jsonb)
    `,
    [
      fixture.primaryCompanyId,
      unknownEventOS,
      fixture.tecnicoId,
    ]
  );

  await assertDiscardCapability(
    "Evento operacional desconhecido bloqueia por defesa em profundidade",
    unknownEventOS,
    tokens.admin,
    false
  );

  await expectHttp(
    "Endpoint recusa OS com evento operacional desconhecido",
    apiRequest(`/os/${unknownEventOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Tentativa com evidencia operacional inconsistente.",
      },
    }),
    409
  );

  const defensivePartsOS = await createOS(
    tokens.admin,
    "defesa peca inconsistente"
  );

  await pool.query(
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
        ($1, $2, 'Peca inserida externamente', 1, 1)
    `,
    [
      defensivePartsOS,
      fixture.primaryCompanyId,
    ]
  );

  await assertDiscardCapability(
    "Peca atual bloqueia descarte mesmo com marker NULL",
    defensivePartsOS,
    tokens.admin,
    false
  );

  await expectHttp(
    "Endpoint recusa OS inconsistente com peca atual",
    apiRequest(`/os/${defensivePartsOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Tentativa com peca atual inconsistente.",
      },
    }),
    409
  );

  // PUT concorrente: a leitura de estado deve ocorrer sob row lock.
  //
  // Cenario deterministico:
  // 1. banco segura FOR UPDATE e altera descricao A -> B sem commit;
  // 2. Tecnico envia valor antigo A;
  // 3. PUT deve esperar;
  // 4. apos commit de B, PUT deve ler B e reconhecer alteracao tecnica;
  // 5. discard_locked_at deve ficar preenchido.
  const concurrencyOS = await createOS(
    tokens.admin,
    "concorrencia PUT"
  );

  const concurrencyInitialResult =
    await pool.query(
      `
        SELECT problema_relatado
        FROM ordens_servico
        WHERE id = $1
          AND company_id = $2
      `,
      [
        concurrencyOS,
        fixture.primaryCompanyId,
      ]
    );

  assert.equal(
    concurrencyInitialResult.rowCount,
    1,
    "OS de concorrencia deveria existir antes do teste."
  );

  const originalConcurrencyDescription =
    concurrencyInitialResult.rows[0]
      .problema_relatado;

  const lockClient =
    await pool.connect();

  let lockTransactionOpen = false;
  let technicianRequest = null;

  try {
    await lockClient.query("BEGIN");
    lockTransactionOpen = true;

    await lockClient.query(
      `
        SELECT id
        FROM ordens_servico
        WHERE id = $1
          AND company_id = $2
        FOR UPDATE
      `,
      [
        concurrencyOS,
        fixture.primaryCompanyId,
      ]
    );

    await lockClient.query(
      `
        UPDATE ordens_servico
        SET problema_relatado = $1
        WHERE id = $2
          AND company_id = $3
      `,
      [
        "Correcao administrativa concorrente",
        concurrencyOS,
        fixture.primaryCompanyId,
      ]
    );

    let requestSettled = false;

    technicianRequest =
      apiRequest(
        `/os/${concurrencyOS}`,
        {
          method: "PUT",
          token: tokens.tecnico,
          body: {
            problema_relatado:
              originalConcurrencyDescription,
          },
        }
      ).finally(() => {
        requestSettled = true;
      });

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 250)
    );

    assert.equal(
      requestSettled,
      false,
      "PUT concorrente deveria aguardar o row lock."
    );

    pass(
      "PUT concorrente aguarda serializacao da linha"
    );

    await lockClient.query("COMMIT");
    lockTransactionOpen = false;

    const technicianResult =
      await technicianRequest;

    assert.equal(
      technicianResult.status,
      200,
      `PUT tecnico concorrente falhou: ${JSON.stringify(technicianResult.body)}`
    );

    pass(
      "PUT tecnico concorrente conclui apos liberar row lock"
    );
  } finally {
    if (lockTransactionOpen) {
      await lockClient
        .query("ROLLBACK")
        .catch(() => {});
    }

    lockClient.release();

    if (technicianRequest) {
      await technicianRequest
        .catch(() => {});
    }
  }

  const concurrencyRow =
    await getOSRow(
      concurrencyOS
    );

  assert.ok(
    concurrencyRow?.discard_locked_at,
    "Alteracao tecnica concorrente deve ativar discard_locked_at."
  );

  pass(
    "Estado concorrente usa versao atual e ativa lock permanente"
  );

  await assertDiscardCapability(
    "OS alterada pelo tecnico em corrida fica can_discard=false",
    concurrencyOS,
    tokens.admin,
    false
  );
  const rollbackOS = await createOS(
    tokens.admin,
    "rollback auditoria"
  );

  await installAuditFailureTrigger();

  await expectHttp(
    "Falha forcada de audit_logs devolve 500",
    apiRequest(`/os/${rollbackOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Teste de atomicidade quando a auditoria falha.",
      },
    }),
    500
  );

  await assertOSExists(
    rollbackOS,
    true
  );

  const rollbackAudit =
    await getDeleteAudit(rollbackOS);

  assert.equal(
    rollbackAudit.length,
    0
  );

  pass(
    "Falha da auditoria reverte hard delete e preserva a OS"
  );

  await removeAuditFailureTrigger();

  await expectHttp(
    "A mesma OS pode ser descartada depois que a falha artificial e removida",
    apiRequest(`/os/${rollbackOS}/descartar`, {
      method: "POST",
      token: tokens.admin,
      body: {
        motivo:
          "Descarte valido apos restaurar a auditoria.",
      },
    }),
    200
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
    await stopBackend().catch((error) => {
      console.error(
        "Falha ao encerrar backend:",
        error.message
      );
    });

    if (databaseApproved && pool) {
      try {
        await cleanupFixtures();
        console.log(
          "Fixtures temporarias removidas."
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
      await pool.end().catch(() => {});
    }
  }

  console.log(
    JSON.stringify(
      {
        status:
          !mainError && !cleanupError
            ? "passed"
            : "failed",
        tests: {
          passed: passedChecks,
        },
      },
      null,
      2
    )
  );

  if (mainError) {
    console.error("\nUltimos logs do backend:");

    for (const item of serverLogs.slice(-30)) {
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