const express = require("express");
const router = express.Router();
const pool = require("../db");
const { authRequired, loadUser } = require("../middlewares/auth");

router.use(authRequired, loadUser);

// Dashboard
router.get("/", async (req, res) => {
  try {
    const companyId = req.user.company_id;

    // =============================
    // EM ANDAMENTO
    // =============================
    const emAndamentoQ = pool.query(
      `SELECT COUNT(*)::int AS total
       FROM ordens_servico
       WHERE company_id = $1
       AND status IN (
         'aprovado',
         'em_execucao',
         'aguardando_peca',
         'pronto_retirada'
       )`,
      [companyId]
    );

    // =============================
    // ORÇAMENTOS PENDENTES
    // =============================
    const orcPendentesQ = pool.query(
      `SELECT COUNT(*)::int AS total
       FROM ordens_servico
       WHERE company_id = $1
       AND status IN (
         'triagem',
         'em_analise',
         'aguardando_aprovacao',
         'orcamento_enviado'
       )`,
      [companyId]
    );

    // =============================
    // ENCERRADOS NO MÊS
    // =============================
    const finalizadosMesQ = pool.query(
      `SELECT COUNT(*)::int AS total
       FROM ordens_servico
       WHERE company_id = $1
       AND status IN ('encerrado', 'finalizado')
       AND closed_at IS NOT NULL
       AND (closed_at AT TIME ZONE 'America/Sao_Paulo')
           >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
       AND (closed_at AT TIME ZONE 'America/Sao_Paulo')
           < (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')`,
      [companyId]
    );

    // =============================
    // FATURAMENTO DO MÊS
    // =============================
    const faturamentoMesQ = pool.query(
      `SELECT COALESCE(SUM(valor_total),0)::numeric(12,2) AS total
       FROM ordens_servico
       WHERE company_id = $1
       AND status IN ('encerrado', 'finalizado')
       AND closed_at IS NOT NULL
       AND (closed_at AT TIME ZONE 'America/Sao_Paulo')
           >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
       AND (closed_at AT TIME ZONE 'America/Sao_Paulo')
           < (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')`,
      [companyId]
    );

    // =============================
    // CONTAGEM POR STATUS
    // =============================
    const porStatusQ = pool.query(
      `SELECT status, COUNT(*)::int AS total
       FROM ordens_servico
       WHERE company_id = $1
       GROUP BY status
       ORDER BY status`,
      [companyId]
    );

    // =============================
    // ÚLTIMAS OS
    // =============================
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
       ORDER BY os.id DESC
       LIMIT 5`,
      [companyId]
    );

    const [
      emAndamento,
      orcPendentes,
      finalizadosMes,
      faturamentoMes,
      porStatus,
      ultimasOS,
    ] = await Promise.all([
      emAndamentoQ,
      orcPendentesQ,
      finalizadosMesQ,
      faturamentoMesQ,
      porStatusQ,
      ultimasOSQ,
    ]);

    res.json({
      timezone: "America/Sao_Paulo",
      company_id: companyId,
      cards: {
        em_andamento: emAndamento.rows[0].total,
        orcamentos_pendentes: orcPendentes.rows[0].total,
        finalizados_no_mes: finalizadosMes.rows[0].total,
        faturamento_mes: faturamentoMes.rows[0].total,
      },
      por_status: porStatus.rows,
      ultimas_os: ultimasOS.rows,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;