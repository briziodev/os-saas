const express = require("express");
const router = express.Router();
const pool = require("../db");
const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const validate = require("../middlewares/validate");
const { dashboardQuerySchema } = require("../validators/dashboardSchemas");

router.use(authRequired, loadUser);

const SAO_PAULO_TZ = "America/Sao_Paulo";

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
      createdClause: "",
      closedClause: "",
      params: (companyId) => [companyId],
      label: "Todo o período",
    };
  }

  return {
    period: "month",
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
  async (req, res) => {
    try {
      const companyId = req.user.company_id;
      const range = parsePeriodRange(req.query);
      const baseParams = range.params(companyId);

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
         AND os.status IN (
           'triagem',
           'em_analise',
           'aguardando_aprovacao',
           'orcamento_enviado'
         )`,
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

      const faturamentoPeriodoQ = pool.query(
        `SELECT COALESCE(SUM(os.valor_total),0)::numeric(12,2) AS total
         FROM ordens_servico os
         WHERE os.company_id = $1
         AND os.status IN ('encerrado', 'finalizado')
         AND os.closed_at IS NOT NULL
         ${range.closedClause}`,
        baseParams
      );

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
        emAndamento,
        orcPendentes,
        finalizadosPeriodo,
        faturamentoPeriodo,
        porStatus,
        ultimasOS,
      ] = await Promise.all([
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
          start_date: range.startDate || null,
          end_date: range.endDate || null,
        },
        cards: {
          em_andamento: emAndamento.rows[0].total,
          orcamentos_pendentes: orcPendentes.rows[0].total,
          finalizados_no_periodo: finalizadosPeriodo.rows[0].total,
          faturamento_periodo: faturamentoPeriodo.rows[0].total,
        },
        por_status: porStatus.rows,
        ultimas_os: ultimasOS.rows,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;