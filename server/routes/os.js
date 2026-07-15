const { requireRole } = require("../middlewares/requireRole");
const express = require("express");
const router = express.Router();
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");
const validate = require("../middlewares/validate");
const { logger } = require("../utils/logger");
const { sensitiveActionLimiter } = require("../middlewares/rateLimiters");
const {
  osIdParamSchema,
  osPecaParamSchema,
  osCreateSchema,
  osUpdateSchema,
  osReopenSchema,
  osPecaCreateSchema,
  osPecaUpdateSchema,
} = require("../validators/osSchemas");

router.use(authRequired, loadUser);

function formatMoneyBR(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function sanitizePhoneBR(phone) {
  let clean = String(phone || "").replace(/\D/g, "");

  if (!clean.startsWith("55")) {
    clean = `55${clean}`;
  }

  return clean;
}

function isValidWhatsappPhoneBR(phone) {
  return /^55\d{10,11}$/.test(String(phone || ""));
}


const OS_IN_PROGRESS_STATUSES = [
  "aprovado",
  "em_execucao",
  "aguardando_peca",
  "pronto_retirada",
];

const OS_STATUS_FILTERS = new Set([
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "aprovado",
  "em_execucao",
  "em_andamento",
  "aguardando_peca",
  "pronto_retirada",
  "encerrado",
  "cancelado",
  "orcamento_enviado",
  "finalizado",
]);

function parseOSStatusFilter(value) {
  const status = String(value || "all").trim();

  if (!status || status === "all" || status === "todos") {
    return { status: "all", clause: "" };
  }

  if (!OS_STATUS_FILTERS.has(status)) {
    return { error: "Status inválido para filtro de OS." };
  }

  if (status === "em_andamento") {
    return {
      status,
      clause: "status_group",
      statuses: OS_IN_PROGRESS_STATUSES,
    };
  }

  return { status, clause: "status" };
}

function parseOSDateFilter(query) {
  const period = String(query.period || "all").trim();
  const startDate = String(query.start_date || "").trim();
  const endDate = String(query.end_date || "").trim();

  if (period === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return { error: "Para período personalizado, informe data inicial e final válidas." };
    }

    if (startDate > endDate) {
      return { error: "A data inicial não pode ser maior que a data final." };
    }

    return {
      period,
      startDate,
      endDate,
      clause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date",
      params: (companyId) => [companyId, startDate, endDate],
    };
  }

  if (period === "today") {
    return {
      period,
      clause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date",
      params: (companyId) => [companyId],
    };
  }

  if (period === "7d") {
    return {
      period,
      clause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 6)",
      params: (companyId) => [companyId],
    };
  }

  if (period === "month") {
    return {
      period,
      clause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo') >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AND (os.created_at AT TIME ZONE 'America/Sao_Paulo') < (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')",
      params: (companyId) => [companyId],
    };
  }

  return {
    period: "all",
    clause: "",
    params: (companyId) => [companyId],
  };
}

async function getCompanyDisplayColumn(db = pool) {
  const candidates = ["name", "nome", "nome_fantasia", "razao_social"];

  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'companies'`
  );

  const existing = new Set(result.rows.map((row) => row.column_name));
  return candidates.find((column) => existing.has(column)) || null;
}

async function getPecasOS(osId, companyId, db = pool) {
  const result = await db.query(
    `SELECT id, nome, quantidade, valor_unitario, valor_total
     FROM os_pecas
     WHERE os_id = $1 AND company_id = $2
     ORDER BY id ASC`,
    [osId, companyId]
  );

  return result.rows;
}

const CANCELLED_STATUS = "cancelado";
const REOPEN_TARGET_STATUS = "triagem";
const BUDGET_VALIDITY_DAYS = 5;
const BUDGET_TARGET_STATUS = "aguardando_aprovacao";
const BUDGET_ALLOWED_STATUSES = new Set([
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "orcamento_enviado",
]);

function cleanWhatsappText(value, fallback = "Não informado") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatQuantityBR(value) {
  const number = Number(value || 0);

  if (Number.isInteger(number)) {
    return String(number);
  }

  return number.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function buildWhatsappMessage(osData, pecas = []) {
  const clienteNome = cleanWhatsappText(osData.nome, "cliente");
  const oficinaNome = cleanWhatsappText(osData.oficina_nome, "nossa oficina");
  const modelo = cleanWhatsappText(osData.modelo);
  const placa = cleanWhatsappText(osData.placa);
  const problemaRelatado = cleanWhatsappText(osData.problema_relatado);

  const linhas = [
    `Olá, ${clienteNome}, tudo bem?`,
    "",
    `Aqui é da ${oficinaNome}.`,
    `Segue o orçamento referente à sua Ordem de Serviço #${osData.id}.`,
    "",
    "DADOS DO VEÍCULO",
    `• Veículo: ${modelo}`,
    `• Placa: ${placa}`,
    "",
    "PROBLEMA RELATADO",
    problemaRelatado,
    "",
    "PEÇAS E MATERIAIS",
  ];

  if (pecas.length > 0) {
    for (const peca of pecas) {
      const nomePeca = cleanWhatsappText(peca.nome, "Item");
      const quantidade = formatQuantityBR(peca.quantidade);

      linhas.push(
        `• ${quantidade}x ${nomePeca} — ${formatMoneyBR(peca.valor_unitario)} un. = ${formatMoneyBR(peca.valor_total)}`
      );
    }

    linhas.push(`Subtotal de peças: ${formatMoneyBR(osData.valor_pecas)}`);
  } else {
    linhas.push("• Nenhuma peça/material lançado neste orçamento.");
  }

  linhas.push("");
  linhas.push("MÃO DE OBRA");
  linhas.push(`• ${formatMoneyBR(osData.mao_obra)}`);
  linhas.push("");
  linhas.push("TOTAL DO ORÇAMENTO");
  linhas.push(`• ${formatMoneyBR(osData.valor_total)}`);
  linhas.push("");
  linhas.push("VALIDADE");
  linhas.push(
    `• Este orçamento é válido por ${BUDGET_VALIDITY_DAYS} dias, sujeito à disponibilidade de peças e à manutenção das condições informadas.`
  );
  linhas.push("");
  linhas.push("PARA APROVAR");
  linhas.push(`Responda: APROVO O ORÇAMENTO #${osData.id}`);
  linhas.push("");
  linhas.push("Se tiver qualquer dúvida, é só responder esta mensagem.");

  return linhas.join("\n");
}

async function getWhatsappOSData(
  osId,
  companyId,
  db = pool,
  { forUpdate = false } = {}
) {
  const companyDisplayColumn = await getCompanyDisplayColumn(db);
  const companySelect = companyDisplayColumn
    ? `, comp.${companyDisplayColumn} AS oficina_nome`
    : "";

  const query = `
    SELECT os.id,
           os.status,
           os.valor_total,
           os.valor_pecas,
           os.mao_obra,
           os.problema_relatado,
           os.modelo,
           os.placa,
           c.nome,
           c.telefone
           ${companySelect}
    FROM ordens_servico os
    JOIN clientes c
      ON c.id = os.cliente_id
     AND c.company_id = os.company_id
    LEFT JOIN companies comp
      ON comp.id = os.company_id
    WHERE os.id = $1 AND os.company_id = $2
    ${forUpdate ? "FOR UPDATE OF os" : ""}
  `;

  const result = await db.query(query, [osId, companyId]);
  return result;
}

async function recalcularTotaisOS(osId, companyId, db = pool) {
  const pecasResult = await db.query(
    `SELECT COALESCE(SUM(valor_total), 0) AS total_pecas
     FROM os_pecas
     WHERE os_id = $1 AND company_id = $2`,
    [osId, companyId]
  );

  const totalPecas = Number(pecasResult.rows[0].total_pecas || 0);

  const osResult = await db.query(
    `SELECT mao_obra
     FROM ordens_servico
     WHERE id = $1 AND company_id = $2`,
    [osId, companyId]
  );

  if (osResult.rowCount === 0) {
    const error = new Error("OS não encontrada para recalcular totais");
    error.statusCode = 404;
    throw error;
  }

  const maoObra = Number(osResult.rows[0].mao_obra || 0);
  const valorTotal = maoObra + totalPecas;

  await db.query(
    `UPDATE ordens_servico
     SET valor_pecas = $1,
         valor_total = $2,
         updated_at = now()
     WHERE id = $3 AND company_id = $4`,
    [totalPecas, valorTotal, osId, companyId]
  );
}

function ocultarDadosFinanceirosParaTecnico(os, role) {
  if (role !== "tecnico" || !os) {
    return os;
  }

  const {
    mao_obra,
    valor_pecas,
    valor_total,
    ...osSemDadosFinanceiros
  } = os;

  return osSemDadosFinanceiros;
}

function ocultarListaDadosFinanceirosParaTecnico(lista, role) {
  if (role !== "tecnico") {
    return lista;
  }

  return lista.map((item) => ocultarDadosFinanceirosParaTecnico(item, role));
}

function logOSNotFound(req, event, message, osId) {
  logger.warn(event, message, {
    requestId: req.requestId,
    userId: req.user?.id,
    companyId: req.user?.company_id,
    role: req.user?.role,
    osId: Number(osId),
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
}

const STATUS_LABELS = {
  triagem: "Triagem",
  em_analise: "Em análise",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado",
  em_execucao: "Em execução",
  aguardando_peca: "Aguardando peça",
  pronto_retirada: "Pronto para retirada",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
  orcamento_enviado: "Orçamento enviado",
  finalizado: "Finalizado",
};

function formatStatusLabel(status) {
  return STATUS_LABELS[status] || String(status || "Não informado").replace(/_/g, " ");
}

function normalizeNullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function stripSensitiveEventMetadata(metadata, role) {
  if (role !== "tecnico" || !metadata || typeof metadata !== "object") {
    return metadata || null;
  }

  const {
    mao_obra,
    old_mao_obra,
    new_mao_obra,
    valor_pecas,
    valor_total,
    valor_unitario,
    part_value,
    total,
    ...safeMetadata
  } = metadata;

  return safeMetadata;
}

async function insertOsEvent(
  db,
  req,
  { osId, eventType, title, description = null, metadata = null }
) {
  await db.query(
    `INSERT INTO os_events
     (company_id, os_id, user_id, event_type, title, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      req.user.company_id,
      osId,
      req.user.id,
      eventType,
      title,
      description,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

async function createOsEvent(req, eventData) {
  const { osId, eventType } = eventData;

  try {
    await insertOsEvent(pool, req, eventData);
  } catch (err) {
    logger.warn("OS_EVENT_CREATE_FAILED", "Falha ao registrar evento da OS", {
      requestId: req.requestId,
      userId: req.user?.id,
      companyId: req.user?.company_id,
      role: req.user?.role,
      osId: Number(osId),
      eventType,
      error: err.message,
      ip: req.ip,
    });
  }
}

router.get("/", async (req, res, next) => {
  try {
    const filter = parseOSDateFilter(req.query);

    if (filter.error) {
      return res.status(400).json({
        error: filter.error,
        requestId: req.requestId,
      });
    }

    const statusFilter = parseOSStatusFilter(req.query.status);

    if (statusFilter.error) {
      return res.status(400).json({
        error: statusFilter.error,
        requestId: req.requestId,
      });
    }

    const params = filter.params(req.user.company_id);
    let statusClause = "";

    if (statusFilter.status !== "all") {
      if (statusFilter.clause === "status_group") {
        const statusPlaceholders = statusFilter.statuses
          .map((status) => {
            params.push(status);
            return `$${params.length}`;
          })
          .join(", ");

        statusClause = `AND os.status IN (${statusPlaceholders})`;
      } else {
        params.push(statusFilter.status);
        statusClause = `AND os.status = $${params.length}`;
      }
    }

    const result = await pool.query(
      `SELECT os.id,
              os.cliente_id,
              c.nome AS cliente_nome,
              os.placa,
              os.modelo,
              os.problema_relatado,
              os.mao_obra,
              os.valor_pecas,
              os.valor_total,
              os.status,
              os.user_id,
              COALESCE(u.name, u.email) AS usuario_nome,
              os.created_at,
              os.updated_at,
              os.closed_at
       FROM ordens_servico os
       JOIN clientes c
         ON c.id = os.cliente_id
        AND c.company_id = os.company_id
       LEFT JOIN users u
         ON u.id = os.user_id
        AND u.company_id = os.company_id
       WHERE os.company_id = $1
       ${filter.clause}
       ${statusClause}
       ORDER BY os.id DESC`,
      params
    );

    return res.json(ocultarListaDadosFinanceirosParaTecnico(result.rows, req.user.role));
  } catch (err) {
    return next(err);
  }
});

router.get(
  "/:id",
  validate(osIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT os.id,
                os.cliente_id,
                c.nome AS cliente_nome,
                os.placa,
                os.modelo,
                os.problema_relatado,
                os.mao_obra,
                os.valor_pecas,
                os.valor_total,
                os.status,
                os.user_id,
                COALESCE(u.name, u.email) AS usuario_nome,
                os.created_at,
                os.updated_at,
                os.closed_at
         FROM ordens_servico os
         JOIN clientes c
           ON c.id = os.cliente_id
          AND c.company_id = os.company_id
         LEFT JOIN users u
           ON u.id = os.user_id
          AND u.company_id = os.company_id
         WHERE os.id = $1 AND os.company_id = $2`,
        [id, req.user.company_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      return res.json(ocultarDadosFinanceirosParaTecnico(result.rows[0], req.user.role));
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/:id/events",
  requireRole("admin", "atendimento", "tecnico"),
  validate(osIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const osCheck = await pool.query(
        "SELECT id FROM ordens_servico WHERE id = $1 AND company_id = $2",
        [id, req.user.company_id]
      );

      if (osCheck.rowCount === 0) {
        logOSNotFound(req, "OS_EVENTS_NOT_FOUND", "Tentativa de listar eventos de OS inexistente", id);

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      const params = [id, req.user.company_id];
      const tecnicoAllowedEvents = [
        "os_created",
        "os_updated",
        "status_changed",
        "description_updated",
        "vehicle_updated",
        "os_reopened",
      ];
      let eventFilter = "";

      if (req.user.role === "tecnico") {
        params.push(tecnicoAllowedEvents);
        eventFilter = `AND e.event_type = ANY($${params.length}::text[])`;
      }

      const result = await pool.query(
        `SELECT e.id,
                e.event_type,
                e.title,
                e.description,
                e.metadata,
                e.created_at,
                COALESCE(u.name, u.email, 'Sistema') AS user_name,
                u.role AS user_role
         FROM os_events e
         LEFT JOIN users u
           ON u.id = e.user_id
          AND u.company_id = e.company_id
         WHERE e.os_id = $1
           AND e.company_id = $2
           ${eventFilter}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT 10`,
        params
      );

      const events = result.rows.map((event) => ({
        ...event,
        metadata: stripSensitiveEventMetadata(event.metadata, req.user.role),
      }));

      return res.json(events);
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  "/:id/whatsapp-link",
  sensitiveActionLimiter,
  requireRole("admin", "atendimento"),
  validate(osIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const osId = Number(id);
      const result = await getWhatsappOSData(id, req.user.company_id);

      if (result.rowCount === 0) {
        logOSNotFound(
          req,
          "OS_WHATSAPP_LEGACY_NOT_FOUND",
          "Tentativa de usar endpoint legado para OS inexistente",
          id
        );

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      const osData = result.rows[0];

      if (!BUDGET_ALLOWED_STATUSES.has(osData.status)) {
        logger.warn(
          "OS_WHATSAPP_LEGACY_BLOCKED_STATUS",
          "Endpoint legado de WhatsApp bloqueado pelo status da OS",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: osData.status,
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: `Não é possível preparar orçamento para uma OS com status ${formatStatusLabel(osData.status)}.`,
          requestId: req.requestId,
        });
      }

      if (!osData.telefone) {
        logger.warn(
          "OS_WHATSAPP_LEGACY_BLOCKED_NO_PHONE",
          "Endpoint legado de WhatsApp bloqueado: cliente sem telefone",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: osData.status,
            ip: req.ip,
          }
        );

        return res.status(400).json({
          error: "Cliente sem telefone",
          requestId: req.requestId,
        });
      }

      const telefoneLimpo = sanitizePhoneBR(osData.telefone);

      if (!isValidWhatsappPhoneBR(telefoneLimpo)) {
        logger.warn(
          "OS_WHATSAPP_LEGACY_BLOCKED_INVALID_PHONE",
          "Endpoint legado de WhatsApp bloqueado: telefone inválido",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: osData.status,
            ip: req.ip,
          }
        );

        return res.status(400).json({
          error: "Telefone do cliente inválido para WhatsApp",
          requestId: req.requestId,
        });
      }

      const pecas = await getPecasOS(id, req.user.company_id);
      const mensagem = buildWhatsappMessage(osData, pecas);
      const url = `https://wa.me/${telefoneLimpo}?text=${encodeURIComponent(mensagem)}`;

      logger.warn(
        "OS_WHATSAPP_LEGACY_ENDPOINT_USED",
        "Endpoint GET legado de WhatsApp utilizado sem efeitos no banco",
        {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          osId,
          osStatus: osData.status,
          partsCount: pecas.length,
          ip: req.ip,
        }
      );

      res.set("Deprecation", "true");
      res.set(
        "Warning",
        '299 - "Endpoint legado. Use POST /os/:id/enviar-orcamento."'
      );

      return res.json({
        whatsapp_url: url,
        deprecated: true,
        requestId: req.requestId,
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  "/",
  requireRole("admin", "atendimento"),
  validate(osCreateSchema),
  async (req, res, next) => {
    try {
      const {
        cliente_id,
        problema_relatado,
        mao_obra,
        valor_pecas,
        placa,
        modelo,
      } = req.body;

      const cliente = await pool.query(
        "SELECT id FROM clientes WHERE id = $1 AND company_id = $2",
        [cliente_id, req.user.company_id]
      );

      if (cliente.rowCount === 0) {
        logger.warn("OS_CREATE_BLOCKED_INVALID_CLIENT", "Criação de OS bloqueada: cliente não pertence à empresa", {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          clienteId: Number(cliente_id),
          ip: req.ip,
        });

        return res.status(400).json({
          error: "Cliente não pertence à sua empresa",
          requestId: req.requestId,
        });
      }

      const total = Number(mao_obra) + Number(valor_pecas);

      const result = await pool.query(
        `INSERT INTO ordens_servico
         (cliente_id, placa, modelo, problema_relatado,
          mao_obra, valor_pecas, valor_total,
          status, user_id, company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'triagem',$8,$9)
         RETURNING *`,
        [
          cliente_id,
          placa,
          modelo,
          problema_relatado,
          mao_obra,
          valor_pecas,
          total,
          req.user.id,
          req.user.company_id,
        ]
      );

      const createdOS = result.rows[0];

      logger.info("OS_CREATED", "Ordem de serviço criada", {
        requestId: req.requestId,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        osId: createdOS.id,
        clienteId: createdOS.cliente_id,
        status: createdOS.status,
        ip: req.ip,
      });

      await createOsEvent(req, {
        osId: createdOS.id,
        eventType: "os_created",
        title: "OS criada",
        description: `OS #${createdOS.id} criada em ${formatStatusLabel(createdOS.status)}.`,
        metadata: {
          status: createdOS.status,
          cliente_id: createdOS.cliente_id,
        },
      });

      return res.status(201).json(createdOS);
    } catch (err) {
      return next(err);
    }
  }
);

router.put(
  "/:id",
  requireRole("admin", "atendimento", "tecnico"),
  validate(osIdParamSchema, "params"),
  validate(osUpdateSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status, mao_obra, problema_relatado, modelo, placa } = req.body;

      if (req.user.role === "tecnico") {
        const camposEnviados = Object.keys(req.body);
        const camposPermitidos = ["status", "problema_relatado"];
        const campoInvalido = camposEnviados.find((campo) => !camposPermitidos.includes(campo));

        if (campoInvalido) {
          logger.warn("OS_UPDATE_BLOCKED_FOR_TECHNICIAN", "Técnico tentou alterar campo não permitido da OS", {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            blockedField: campoInvalido,
            ip: req.ip,
          });

          return res.status(403).json({
            error: "Técnico só pode alterar descrição do serviço e status.",
            requestId: req.requestId,
          });
        }

        if (status === CANCELLED_STATUS) {
          logger.warn(
            "OS_CANCEL_BLOCKED_FOR_TECHNICIAN",
            "Técnico tentou cancelar uma OS",
            {
              requestId: req.requestId,
              userId: req.user.id,
              companyId: req.user.company_id,
              role: req.user.role,
              osId: Number(id),
              ip: req.ip,
            }
          );

          return res.status(403).json({
            error: "Somente administrador ou atendimento pode cancelar uma OS.",
            requestId: req.requestId,
          });
        }
      }

      const current = await pool.query(
        `SELECT mao_obra, valor_pecas, status, problema_relatado, modelo, placa
         FROM ordens_servico
         WHERE id = $1 AND company_id = $2`,
        [id, req.user.company_id]
      );

      if (current.rowCount === 0) {
        logOSNotFound(req, "OS_UPDATE_NOT_FOUND", "Tentativa de atualizar OS inexistente", id);

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      const cur = current.rows[0];

      if (cur.status === CANCELLED_STATUS) {
        logger.warn(
          "OS_UPDATE_BLOCKED_CANCELLED",
          "Tentativa de alterar OS cancelada pelo fluxo comum",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            attemptedFields: Object.keys(req.body),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS está cancelada e não pode ser alterada. Use a ação de reabertura.",
          requestId: req.requestId,
        });
      }

      const newMao =
        req.user.role === "tecnico"
          ? Number(cur.mao_obra)
          : mao_obra !== undefined
            ? Number(mao_obra)
            : Number(cur.mao_obra);

      const newPecas = Number(cur.valor_pecas || 0);
      const newTotal = newMao + newPecas;

      const result = await pool.query(
        `UPDATE ordens_servico
         SET
           problema_relatado = COALESCE($1, problema_relatado),
           mao_obra = COALESCE($2, mao_obra),
           valor_total = $3,
           status = COALESCE($4, status),
           modelo = COALESCE($5, modelo),
           placa = COALESCE($6, placa),
           updated_at = now(),
           closed_at = CASE
             WHEN COALESCE($4, status) IN ('encerrado','finalizado','cancelado')
             THEN COALESCE(closed_at, now())
             ELSE NULL
           END
         WHERE id = $7
           AND company_id = $8
           AND status <> 'cancelado'
         RETURNING *`,
        [
          problema_relatado ?? null,
          mao_obra ?? null,
          newTotal,
          status ?? null,
          modelo ?? null,
          placa ?? null,
          id,
          req.user.company_id,
        ]
      );

      if (result.rowCount === 0) {
        logger.warn(
          "OS_UPDATE_BLOCKED_CANCELLED_RACE",
          "Atualização bloqueada porque a OS foi cancelada durante a operação",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS foi cancelada e não pode ser alterada. Atualize a página.",
          requestId: req.requestId,
        });
      }

      const updatedOS = result.rows[0];

      logger.info("OS_UPDATED", "Ordem de serviço atualizada", {
        requestId: req.requestId,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        osId: updatedOS.id,
        oldStatus: cur.status,
        newStatus: updatedOS.status,
        changedStatus: cur.status !== updatedOS.status,
        ip: req.ip,
      });

      if (cur.status !== updatedOS.status) {
        logger.info("OS_STATUS_UPDATED", "Status da OS atualizado", {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          osId: updatedOS.id,
          oldStatus: cur.status,
          newStatus: updatedOS.status,
          ip: req.ip,
        });

        await createOsEvent(req, {
          osId: updatedOS.id,
          eventType: "status_changed",
          title: "Status alterado",
          description: `De ${formatStatusLabel(cur.status)} para ${formatStatusLabel(updatedOS.status)}.`,
          metadata: {
            old_status: cur.status,
            new_status: updatedOS.status,
          },
        });
      }

      if (normalizeNullableText(cur.problema_relatado) !== normalizeNullableText(updatedOS.problema_relatado)) {
        await createOsEvent(req, {
          osId: updatedOS.id,
          eventType: "description_updated",
          title: "Problema relatado atualizado",
          description: "A descrição/problema relatado da OS foi atualizado.",
        });
      }

      if (normalizeNullableText(cur.modelo) !== normalizeNullableText(updatedOS.modelo) || normalizeNullableText(cur.placa) !== normalizeNullableText(updatedOS.placa)) {
        await createOsEvent(req, {
          osId: updatedOS.id,
          eventType: "vehicle_updated",
          title: "Dados do veículo atualizados",
          description: "Modelo ou placa da OS foram atualizados.",
          metadata: {
            old_modelo: cur.modelo,
            new_modelo: updatedOS.modelo,
            old_placa: cur.placa,
            new_placa: updatedOS.placa,
          },
        });
      }

      if (req.user.role !== "tecnico" && Number(cur.mao_obra || 0) !== Number(updatedOS.mao_obra || 0)) {
        await createOsEvent(req, {
          osId: updatedOS.id,
          eventType: "financial_updated",
          title: "Valor de mão de obra atualizado",
          description: "O valor de mão de obra da OS foi atualizado.",
          metadata: {
            old_mao_obra: Number(cur.mao_obra || 0),
            new_mao_obra: Number(updatedOS.mao_obra || 0),
            valor_total: Number(updatedOS.valor_total || 0),
          },
        });
      }

      return res.json(ocultarDadosFinanceirosParaTecnico(updatedOS, req.user.role));
    } catch (err) {
      return next(err);
    }
  }
);

router.delete(
  "/:id",
  requireRole("admin"),
  validate(osIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const current = await pool.query(
        `SELECT id, status
         FROM ordens_servico
         WHERE id = $1 AND company_id = $2`,
        [id, req.user.company_id]
      );

      if (current.rowCount === 0) {
        logOSNotFound(req, "OS_DELETE_NOT_FOUND", "Tentativa de excluir OS inexistente", id);

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      if (current.rows[0].status === CANCELLED_STATUS) {
        logger.warn(
          "OS_DELETE_BLOCKED_CANCELLED",
          "Tentativa de excluir OS cancelada",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS está cancelada e não pode ser excluída. Reabra-a antes de qualquer ação administrativa.",
          requestId: req.requestId,
        });
      }

      const result = await pool.query(
        `DELETE FROM ordens_servico
         WHERE id = $1
           AND company_id = $2
           AND status <> 'cancelado'
         RETURNING id, cliente_id, status, company_id`,
        [id, req.user.company_id]
      );

      if (result.rowCount === 0) {
        logger.warn(
          "OS_DELETE_BLOCKED_CANCELLED_RACE",
          "Exclusão bloqueada porque a OS foi cancelada durante a operação",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS foi cancelada e não pode ser excluída. Atualize a página.",
          requestId: req.requestId,
        });
      }

      const deletedOS = result.rows[0];

      logger.warn("OS_DELETED", "Ordem de serviço excluída", {
        requestId: req.requestId,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        osId: deletedOS.id,
        clienteId: deletedOS.cliente_id,
        status: deletedOS.status,
        ip: req.ip,
      });

      return res.json({ deleted: deletedOS, requestId: req.requestId });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  "/:id/reabrir",
  sensitiveActionLimiter,
  requireRole("admin"),
  validate(osIdParamSchema, "params"),
  validate(osReopenSchema),
  async (req, res, next) => {
    const { id } = req.params;
    const osId = Number(id);
    const motivo = String(req.body.motivo || "").trim();
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const current = await client.query(
        `SELECT id, status, closed_at
         FROM ordens_servico
         WHERE id = $1 AND company_id = $2
         FOR UPDATE`,
        [id, req.user.company_id]
      );

      if (current.rowCount === 0) {
        await client.query("ROLLBACK");

        logOSNotFound(
          req,
          "OS_REOPEN_NOT_FOUND",
          "Tentativa de reabrir OS inexistente",
          id
        );

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      const currentOS = current.rows[0];

      if (currentOS.status !== CANCELLED_STATUS) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_REOPEN_BLOCKED_INVALID_STATUS",
          "Tentativa de reabrir OS que não está cancelada",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: currentOS.status,
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: `Somente OS cancelada pode ser reaberta. Status atual: ${formatStatusLabel(currentOS.status)}.`,
          requestId: req.requestId,
        });
      }

      const updated = await client.query(
        `UPDATE ordens_servico
         SET status = $3,
             updated_at = now(),
             closed_at = NULL
         WHERE id = $1 AND company_id = $2
         RETURNING *`,
        [id, req.user.company_id, REOPEN_TARGET_STATUS]
      );

      await insertOsEvent(client, req, {
        osId,
        eventType: "os_reopened",
        title: "OS reaberta",
        description: `De ${formatStatusLabel(CANCELLED_STATUS)} para ${formatStatusLabel(REOPEN_TARGET_STATUS)}. Motivo: ${motivo}`,
        metadata: {
          old_status: CANCELLED_STATUS,
          new_status: REOPEN_TARGET_STATUS,
          reason: motivo,
          source: "controlled_reopen",
        },
      });

      await client.query("COMMIT");

      logger.warn(
        "OS_REOPENED",
        "OS cancelada reaberta por administrador",
        {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          osId,
          oldStatus: CANCELLED_STATUS,
          newStatus: REOPEN_TARGET_STATUS,
          reasonLength: motivo.length,
          ip: req.ip,
        }
      );

      return res.json({
        message: "OS reaberta com sucesso.",
        status: REOPEN_TARGET_STATUS,
        os: updated.rows[0],
        requestId: req.requestId,
      });
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.warn(
            "OS_REOPEN_ROLLBACK_FAILED",
            "Falha ao reverter transação de reabertura da OS",
            {
              requestId: req.requestId,
              userId: req.user?.id,
              companyId: req.user?.company_id,
              role: req.user?.role,
              osId,
              error: rollbackError.message,
              ip: req.ip,
            }
          );
        }
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

router.post(
  "/:id/enviar-orcamento",
  sensitiveActionLimiter,
  requireRole("admin", "atendimento"),
  validate(osIdParamSchema, "params"),
  async (req, res, next) => {
    const { id } = req.params;
    const osId = Number(id);
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const result = await getWhatsappOSData(
        id,
        req.user.company_id,
        client,
        { forUpdate: true }
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");

        logOSNotFound(
          req,
          "OS_BUDGET_SEND_NOT_FOUND",
          "Tentativa de enviar orçamento para OS inexistente",
          id
        );

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      const osData = result.rows[0];
      const oldStatus = osData.status;

      if (!BUDGET_ALLOWED_STATUSES.has(oldStatus)) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_BUDGET_SEND_BLOCKED_STATUS",
          "Envio de orçamento bloqueado pelo status da OS",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: oldStatus,
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: `Não é possível enviar orçamento para uma OS com status ${formatStatusLabel(oldStatus)}.`,
          requestId: req.requestId,
        });
      }

      if (!osData.telefone) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_BUDGET_SEND_BLOCKED_NO_PHONE",
          "Envio de orçamento bloqueado: cliente sem telefone",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: oldStatus,
            ip: req.ip,
          }
        );

        return res.status(400).json({
          error: "Cliente sem telefone",
          requestId: req.requestId,
        });
      }

      const telefoneLimpo = sanitizePhoneBR(osData.telefone);

      if (!isValidWhatsappPhoneBR(telefoneLimpo)) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_BUDGET_SEND_BLOCKED_INVALID_PHONE",
          "Envio de orçamento bloqueado: telefone inválido",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId,
            osStatus: oldStatus,
            ip: req.ip,
          }
        );

        return res.status(400).json({
          error: "Telefone do cliente inválido para WhatsApp",
          requestId: req.requestId,
        });
      }

      const pecas = await getPecasOS(id, req.user.company_id, client);
      const mensagem = buildWhatsappMessage(osData, pecas);
      const url = `https://wa.me/${telefoneLimpo}?text=${encodeURIComponent(mensagem)}`;
      const changedStatus = oldStatus !== BUDGET_TARGET_STATUS;

      if (changedStatus) {
        await client.query(
          `UPDATE ordens_servico
           SET status = $3,
               updated_at = now(),
               closed_at = NULL
           WHERE id = $1 AND company_id = $2`,
          [id, req.user.company_id, BUDGET_TARGET_STATUS]
        );

        await insertOsEvent(client, req, {
          osId,
          eventType: "status_changed",
          title: "Status alterado pelo orçamento",
          description: `De ${formatStatusLabel(oldStatus)} para ${formatStatusLabel(BUDGET_TARGET_STATUS)}.`,
          metadata: {
            old_status: oldStatus,
            new_status: BUDGET_TARGET_STATUS,
            source: "budget_send",
          },
        });
      }

      await insertOsEvent(client, req, {
        osId,
        eventType: "whatsapp_quote_generated",
        title: changedStatus
          ? "Orçamento WhatsApp preparado"
          : "Orçamento WhatsApp preparado novamente",
        description:
          "Orçamento da OS preparado para envio ao cliente pelo WhatsApp.",
        metadata: {
          status: BUDGET_TARGET_STATUS,
          parts_count: pecas.length,
          changed_status: changedStatus,
        },
      });

      await client.query("COMMIT");

      logger.info(
        "OS_BUDGET_PREPARED",
        "Orçamento da OS preparado para envio via WhatsApp",
        {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          osId,
          oldStatus,
          newStatus: BUDGET_TARGET_STATUS,
          partsCount: pecas.length,
          changedStatus,
          ip: req.ip,
        }
      );

      return res.json({
        whatsapp_url: url,
        status: BUDGET_TARGET_STATUS,
        status_changed: changedStatus,
        requestId: req.requestId,
      });
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.warn(
            "OS_BUDGET_ROLLBACK_FAILED",
            "Falha ao reverter transação do orçamento",
            {
              requestId: req.requestId,
              userId: req.user?.id,
              companyId: req.user?.company_id,
              role: req.user?.role,
              osId,
              error: rollbackError.message,
              ip: req.ip,
            }
          );
        }
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

router.get(
  "/:id/pecas",
  requireRole("admin", "atendimento"),
  validate(osIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const osCheck = await pool.query(
        "SELECT id FROM ordens_servico WHERE id = $1 AND company_id = $2",
        [id, req.user.company_id]
      );

      if (osCheck.rowCount === 0) {
        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      const result = await pool.query(
        `SELECT id, nome, quantidade, valor_unitario, valor_total, created_at
         FROM os_pecas
         WHERE os_id = $1 AND company_id = $2
         ORDER BY id DESC`,
        [id, req.user.company_id]
      );

      return res.json(result.rows);
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  "/:id/pecas",
  requireRole("admin", "atendimento"),
  validate(osIdParamSchema, "params"),
  validate(osPecaCreateSchema),
  async (req, res, next) => {
    const { id } = req.params;
    const { nome, quantidade, valor_unitario } = req.body;
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const osCheck = await client.query(
        `SELECT id, status
         FROM ordens_servico
         WHERE id = $1 AND company_id = $2
         FOR UPDATE`,
        [id, req.user.company_id]
      );

      if (osCheck.rowCount === 0) {
        await client.query("ROLLBACK");

        logOSNotFound(req, "OS_PART_CREATE_NOT_FOUND", "Tentativa de adicionar peça em OS inexistente", id);

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      if (osCheck.rows[0].status === CANCELLED_STATUS) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_PART_CREATE_BLOCKED_CANCELLED",
          "Tentativa de adicionar peça em OS cancelada",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS está cancelada e não permite adicionar peças.",
          requestId: req.requestId,
        });
      }

      const result = await client.query(
        `INSERT INTO os_pecas (os_id, company_id, nome, quantidade, valor_unitario)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, nome, quantidade, valor_unitario, valor_total, created_at`,
        [id, req.user.company_id, nome, quantidade, valor_unitario]
      );

      await recalcularTotaisOS(id, req.user.company_id, client);

      const createdPart = result.rows[0];

      await insertOsEvent(client, req, {
        osId: Number(id),
        eventType: "piece_added",
        title: "Peça adicionada",
        description: `Peça adicionada: ${createdPart.nome} (${Number(createdPart.quantidade)}x).`,
        metadata: {
          part_id: createdPart.id,
          part_name: createdPart.nome,
          quantity: Number(createdPart.quantidade),
          valor_unitario: Number(createdPart.valor_unitario || 0),
          valor_total: Number(createdPart.valor_total || 0),
        },
      });

      await client.query("COMMIT");

      logger.info("OS_PART_CREATED", "Peça adicionada à OS", {
        requestId: req.requestId,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        osId: Number(id),
        partId: createdPart.id,
        quantity: Number(createdPart.quantidade),
        ip: req.ip,
      });

      return res.status(201).json(createdPart);
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.warn(
            "OS_PART_CREATE_ROLLBACK_FAILED",
            "Falha ao reverter inclusão de peça",
            {
              requestId: req.requestId,
              userId: req.user?.id,
              companyId: req.user?.company_id,
              role: req.user?.role,
              osId: Number(id),
              error: rollbackError.message,
              ip: req.ip,
            }
          );
        }
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

router.put(
  "/:id/pecas/:pecaId",
  requireRole("admin", "atendimento"),
  validate(osPecaParamSchema, "params"),
  validate(osPecaUpdateSchema),
  async (req, res, next) => {
    const { id, pecaId } = req.params;
    const { nome, quantidade, valor_unitario } = req.body;
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const osCheck = await client.query(
        `SELECT id, status
         FROM ordens_servico
         WHERE id = $1 AND company_id = $2
         FOR UPDATE`,
        [id, req.user.company_id]
      );

      if (osCheck.rowCount === 0) {
        await client.query("ROLLBACK");

        logOSNotFound(req, "OS_PART_UPDATE_OS_NOT_FOUND", "Tentativa de atualizar peça de OS inexistente", id);

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      if (osCheck.rows[0].status === CANCELLED_STATUS) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_PART_UPDATE_BLOCKED_CANCELLED",
          "Tentativa de atualizar peça em OS cancelada",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            partId: Number(pecaId),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS está cancelada e não permite alterar peças.",
          requestId: req.requestId,
        });
      }

      const result = await client.query(
        `UPDATE os_pecas
         SET nome = $1,
             quantidade = $2,
             valor_unitario = $3
         WHERE id = $4 AND os_id = $5 AND company_id = $6
         RETURNING id, nome, quantidade, valor_unitario, valor_total, created_at`,
        [nome, quantidade, valor_unitario, pecaId, id, req.user.company_id]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");

        logger.warn("OS_PART_UPDATE_NOT_FOUND", "Tentativa de atualizar peça inexistente", {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          osId: Number(id),
          partId: Number(pecaId),
          ip: req.ip,
        });

        return res.status(404).json({
          error: "Peça não encontrada",
          requestId: req.requestId,
        });
      }

      await recalcularTotaisOS(id, req.user.company_id, client);

      const updatedPart = result.rows[0];

      await insertOsEvent(client, req, {
        osId: Number(id),
        eventType: "piece_updated",
        title: "Peça atualizada",
        description: `Peça atualizada: ${updatedPart.nome} (${Number(updatedPart.quantidade)}x).`,
        metadata: {
          part_id: updatedPart.id,
          part_name: updatedPart.nome,
          quantity: Number(updatedPart.quantidade),
          valor_unitario: Number(updatedPart.valor_unitario || 0),
          valor_total: Number(updatedPart.valor_total || 0),
        },
      });

      await client.query("COMMIT");

      logger.info("OS_PART_UPDATED", "Peça da OS atualizada", {
        requestId: req.requestId,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        osId: Number(id),
        partId: updatedPart.id,
        quantity: Number(updatedPart.quantidade),
        ip: req.ip,
      });

      return res.json(updatedPart);
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.warn(
            "OS_PART_UPDATE_ROLLBACK_FAILED",
            "Falha ao reverter atualização de peça",
            {
              requestId: req.requestId,
              userId: req.user?.id,
              companyId: req.user?.company_id,
              role: req.user?.role,
              osId: Number(id),
              partId: Number(pecaId),
              error: rollbackError.message,
              ip: req.ip,
            }
          );
        }
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

router.delete(
  "/:id/pecas/:pecaId",
  requireRole("admin", "atendimento"),
  validate(osPecaParamSchema, "params"),
  async (req, res, next) => {
    const { id, pecaId } = req.params;
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const osCheck = await client.query(
        `SELECT id, status
         FROM ordens_servico
         WHERE id = $1 AND company_id = $2
         FOR UPDATE`,
        [id, req.user.company_id]
      );

      if (osCheck.rowCount === 0) {
        await client.query("ROLLBACK");

        logOSNotFound(req, "OS_PART_DELETE_OS_NOT_FOUND", "Tentativa de remover peça de OS inexistente", id);

        return res.status(404).json({
          error: "OS não encontrada",
          requestId: req.requestId,
        });
      }

      if (osCheck.rows[0].status === CANCELLED_STATUS) {
        await client.query("ROLLBACK");

        logger.warn(
          "OS_PART_DELETE_BLOCKED_CANCELLED",
          "Tentativa de remover peça de OS cancelada",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            osId: Number(id),
            partId: Number(pecaId),
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error: "Esta OS está cancelada e não permite remover peças.",
          requestId: req.requestId,
        });
      }

      const result = await client.query(
        `DELETE FROM os_pecas
         WHERE id = $1 AND os_id = $2 AND company_id = $3
         RETURNING id, os_id, company_id, nome, quantidade`,
        [pecaId, id, req.user.company_id]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");

        logger.warn("OS_PART_DELETE_NOT_FOUND", "Tentativa de excluir peça inexistente", {
          requestId: req.requestId,
          userId: req.user.id,
          companyId: req.user.company_id,
          role: req.user.role,
          osId: Number(id),
          partId: Number(pecaId),
          ip: req.ip,
        });

        return res.status(404).json({
          error: "Peça não encontrada",
          requestId: req.requestId,
        });
      }

      await recalcularTotaisOS(id, req.user.company_id, client);

      const deletedPart = result.rows[0];

      await insertOsEvent(client, req, {
        osId: Number(id),
        eventType: "piece_removed",
        title: "Peça removida",
        description: `Peça removida: ${deletedPart.nome} (${Number(deletedPart.quantidade)}x).`,
        metadata: {
          part_id: deletedPart.id,
          part_name: deletedPart.nome,
          quantity: Number(deletedPart.quantidade),
        },
      });

      await client.query("COMMIT");

      logger.warn("OS_PART_DELETED", "Peça removida da OS", {
        requestId: req.requestId,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        osId: Number(id),
        partId: deletedPart.id,
        quantity: Number(deletedPart.quantidade),
        ip: req.ip,
      });

      return res.json({ deleted: deletedPart, requestId: req.requestId });
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          logger.warn(
            "OS_PART_DELETE_ROLLBACK_FAILED",
            "Falha ao reverter remoção de peça",
            {
              requestId: req.requestId,
              userId: req.user?.id,
              companyId: req.user?.company_id,
              role: req.user?.role,
              osId: Number(id),
              partId: Number(pecaId),
              error: rollbackError.message,
              ip: req.ip,
            }
          );
        }
      }

      return next(err);
    } finally {
      client?.release();
    }
  }
);

module.exports = router;