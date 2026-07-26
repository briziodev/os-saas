const express = require("express");
const router = express.Router();
const pool = require("../db");
const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const validate = require("../middlewares/validate");
const { dashboardQuerySchema } = require("../validators/dashboardSchemas");

router.use(authRequired, loadUser);

const SAO_PAULO_TZ = "America/Sao_Paulo";


const ACTION_NOTIFICATION_META = [
  {
    key: "triagem",
    title: "OS em triagem",
    description: "Ordens criadas aguardando classificação inicial.",
    severity: "info",
  },
  {
    key: "em_analise",
    title: "OS em análise",
    description: "Aguardando diagnóstico ou revisão técnica.",
    severity: "info",
  },
  {
    key: "aguardando_aprovacao",
    title: "Orçamentos aguardando aprovação",
    description: "Clientes precisam aprovar orçamento.",
    severity: "warning",
  },
  {
    key: "orcamento_enviado",
    title: "Orçamentos enviados",
    description: "Orçamentos enviados aguardando resposta.",
    severity: "warning",
  },
  {
    key: "aprovado",
    title: "OS aprovadas para iniciar",
    description: "Cliente aprovou e a oficina precisa iniciar.",
    severity: "success",
  },
  {
    key: "em_execucao",
    title: "OS em execução",
    description: "Serviços em andamento para acompanhar.",
    severity: "info",
  },
  {
    key: "aguardando_peca",
    title: "OS aguardando peça",
    description: "Serviços parados por falta de peça.",
    severity: "warning",
  },
  {
    key: "pronto_retirada",
    title: "Prontas para retirada",
    description: "Serviços prontos para cliente retirar.",
    severity: "success",
  },
];

function dashboardPeriodParams(range) {
  const params = new URLSearchParams();
  params.set("period", range.period);

  if (range.period === "custom") {
    params.set("start_date", range.startDate);
    params.set("end_date", range.endDate);
  }

  return params;
}

function buildActionNotifications(statusRows, range) {
  const countsByStatus = new Map(
    statusRows.map((row) => [row.status, Number(row.total || 0)])
  );

  const items = ACTION_NOTIFICATION_META.map((meta) => {
    const count = countsByStatus.get(meta.key) || 0;

    return {
      ...meta,
      count,
      href: (() => {
        const params = dashboardPeriodParams(range);
        params.set("status", meta.key);
        return `/os?${params.toString()}`;
      })(),
    };
  }).filter((item) => item.count > 0);

  return {
    total: items.reduce((sum, item) => sum + item.count, 0),
    items,
  };
}

function parsePeriodRange(query) {
  const period = query.period || "month";
  const startDate = query.start_date || "";
  const endDate = query.end_date || "";

  if (period === "custom") {
    return {
      period,
      startDate,
      endDate,
      createdClause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date",
      closedClause:
        "AND (os.closed_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date",
      params: (companyId) => [companyId, startDate, endDate],
      label: `${startDate} até ${endDate}`,
    };
  }

  if (period === "today") {
    return {
      period,
      startDate: null,
      endDate: null,
      createdClause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date",
      closedClause:
        "AND (os.closed_at AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date",
      params: (companyId) => [companyId],
      label: "Hoje",
    };
  }

  if (period === "7d") {
    return {
      period,
      startDate: null,
      endDate: null,
      createdClause:
        "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 6)",
      closedClause:
        "AND (os.closed_at AT TIME ZONE 'America/Sao_Paulo')::date >= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 6)",
      params: (companyId) => [companyId],
      label: "Últimos 7 dias",
    };
  }

  if (period === "all") {
    return {
      period,
      startDate: null,
      endDate: null,
      createdClause: "",
      closedClause: "",
      params: (companyId) => [companyId],
      label: "Todo o período",
    };
  }

  return {
    period: "month",
    startDate: null,
    endDate: null,
    createdClause:
      "AND (os.created_at AT TIME ZONE 'America/Sao_Paulo') >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AND (os.created_at AT TIME ZONE 'America/Sao_Paulo') < (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')",
    closedClause:
      "AND (os.closed_at AT TIME ZONE 'America/Sao_Paulo') >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AND (os.closed_at AT TIME ZONE 'America/Sao_Paulo') < (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')",
    params: (companyId) => [companyId],
    label: "Mês atual",
  };
}

// GET /dashboard
router.get(
  "/",
  requireRole("admin", "atendimento"),
  validate(dashboardQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const companyId = req.user.company_id;
      const range = parsePeriodRange(req.query);
      const baseParams = range.params(companyId);

      const abertasPeriodoQ = pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ordens_servico os
         WHERE os.company_id = $1
         ${range.createdClause}`,
        baseParams
      );

      const emAndamentoQ = pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ordens_servico os
         WHERE os.company_id = $1
         ${range.createdClause}
         AND os.status IN (
           'aprovado',
           'em_execucao',
           'aguardando_peca',
           'pronto_retirada'
         )`,
        baseParams
      );

      const orcPendentesQ = pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ordens_servico os
         WHERE os.company_id = $1
         ${range.createdClause}
         AND os.status = 'aguardando_aprovacao'`,
        baseParams
      );

      const finalizadosPeriodoQ = pool.query(
        `SELECT COUNT(*)::int AS total
         FROM ordens_servico os
         WHERE os.company_id = $1
         AND os.status IN ('encerrado', 'finalizado')
         AND os.closed_at IS NOT NULL
         ${range.closedClause}`,
        baseParams
      );

      const faturamentoPeriodoQ =
        req.user.role === "admin"
          ? pool.query(
              `SELECT COALESCE(SUM(os.valor_total), 0)::numeric(12,2) AS total
               FROM ordens_servico os
               WHERE os.company_id = $1
               AND os.status IN ('encerrado', 'finalizado')
               AND os.closed_at IS NOT NULL
               ${range.closedClause}`,
              baseParams
            )
          : Promise.resolve(null);

      const porStatusQ = pool.query(
        `SELECT os.status, COUNT(*)::int AS total
         FROM ordens_servico os
         WHERE os.company_id = $1
         ${range.createdClause}
         GROUP BY os.status
         ORDER BY os.status`,
        baseParams
      );

      const ultimasOSQ = pool.query(
        `SELECT os.id,
                os.status,
                os.valor_total,
                os.created_at,
                os.closed_at,
                c.nome AS cliente_nome,
                os.modelo,
                os.placa
         FROM ordens_servico os
         JOIN clientes c
           ON c.id = os.cliente_id
          AND c.company_id = os.company_id
         WHERE os.company_id = $1
         ${range.createdClause}
         ORDER BY os.id DESC
         LIMIT 5`,
        baseParams
      );

      const [
        abertasPeriodo,
        emAndamento,
        orcPendentes,
        finalizadosPeriodo,
        faturamentoPeriodo,
        porStatus,
        ultimasOS,
      ] = await Promise.all([
        abertasPeriodoQ,
        emAndamentoQ,
        orcPendentesQ,
        finalizadosPeriodoQ,
        faturamentoPeriodoQ,
        porStatusQ,
        ultimasOSQ,
      ]);

      return res.json({
        timezone: SAO_PAULO_TZ,
        company_id: companyId,
        period: {
          key: range.period,
          label: range.label,
          start_date: range.startDate,
          end_date: range.endDate,
        },
        cards: {
          abertas_periodo: abertasPeriodo.rows[0].total,
          em_andamento: emAndamento.rows[0].total,
          orcamentos_pendentes: orcPendentes.rows[0].total,
          finalizados_no_periodo: finalizadosPeriodo.rows[0].total,
          ...(req.user.role === "admin"
            ? {
                faturamento_periodo:
                  faturamentoPeriodo.rows[0].total,
              }
            : {}),
        },
        por_status: porStatus.rows,
        notifications: buildActionNotifications(porStatus.rows, range),
        ultimas_os: ultimasOS.rows,
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;