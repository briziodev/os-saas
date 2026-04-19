const { requireRole } = require("../middlewares/requireRole");
const express = require("express");
const router = express.Router();
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");

router.use(authRequired, loadUser);

const allowedStatus = [
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "aprovado",
  "em_execucao",
  "aguardando_peca",
  "pronto_retirada",
  "encerrado",
  "orcamento_enviado",
  "finalizado",
  "cancelado",
];

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

async function getCompanyDisplayColumn() {
  const candidates = ["name", "nome", "nome_fantasia", "razao_social"];

  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'companies'`
  );

  const existing = new Set(result.rows.map((row) => row.column_name));
  return candidates.find((column) => existing.has(column)) || null;
}

async function getPecasOS(osId, companyId) {
  const result = await pool.query(
    `SELECT id, nome, quantidade, valor_unitario, valor_total
     FROM os_pecas
     WHERE os_id = $1 AND company_id = $2
     ORDER BY id ASC`,
    [osId, companyId]
  );

  return result.rows;
}

function buildWhatsappMessage(osData, pecas = []) {
  const linhas = [
    `Olá, ${osData.nome}.`,
    "",
    "Segue o orçamento da sua ordem de serviço.",
    "",
    `Oficina: ${osData.oficina_nome || "Sua oficina"}`,
    `OS: #${osData.id}`,
    `Veículo: ${osData.modelo || "Não informado"}`,
    `Placa: ${osData.placa || "Não informada"}`,
    "",
    "Problema relatado:",
    `${osData.problema_relatado || "Não informado"}`,
    "",
  ];

  if (pecas.length > 0) {
    linhas.push("Peças:");
    for (const peca of pecas) {
      linhas.push(
        `- ${peca.nome} — ${Number(peca.quantidade)}x ${formatMoneyBR(peca.valor_unitario)} = ${formatMoneyBR(peca.valor_total)}`
      );
    }
    linhas.push("");
    linhas.push(`Total de peças: ${formatMoneyBR(osData.valor_pecas)}`);
  } else {
    linhas.push("Peças: não informadas");
  }

  linhas.push(`Mão de obra: ${formatMoneyBR(osData.mao_obra)}`);
  linhas.push("");
  linhas.push(`Valor total: ${formatMoneyBR(osData.valor_total)}`);
  linhas.push("");
  linhas.push("Este orçamento é válido por 5 dias.");
  linhas.push("");
  linhas.push("Para responder:");
  linhas.push("1 - Aprovo o serviço");
  linhas.push("2 - Quero falar com a oficina");

  return linhas.join("\n");
}

async function getWhatsappOSData(osId, companyId) {
  const companyDisplayColumn = await getCompanyDisplayColumn();
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
    JOIN clientes c ON c.id = os.cliente_id
    LEFT JOIN companies comp ON comp.id = os.company_id
    WHERE os.id = $1 AND os.company_id = $2
  `;

  const result = await pool.query(query, [osId, companyId]);
  return result;
}

async function recalcularTotaisOS(osId, companyId) {
  const pecasResult = await pool.query(
    `SELECT COALESCE(SUM(valor_total), 0) AS total_pecas
     FROM os_pecas
     WHERE os_id = $1 AND company_id = $2`,
    [osId, companyId]
  );

  const totalPecas = Number(pecasResult.rows[0].total_pecas || 0);

  const osResult = await pool.query(
    `SELECT mao_obra
     FROM ordens_servico
     WHERE id = $1 AND company_id = $2`,
    [osId, companyId]
  );

  if (osResult.rowCount === 0) {
    throw new Error("OS não encontrada para recalcular totais");
  }

  const maoObra = Number(osResult.rows[0].mao_obra || 0);
  const valorTotal = maoObra + totalPecas;

  await pool.query(
    `UPDATE ordens_servico
     SET valor_pecas = $1,
         valor_total = $2,
         updated_at = now()
     WHERE id = $3 AND company_id = $4`,
    [totalPecas, valorTotal, osId, companyId]
  );
}

router.get("/", async (req, res) => {
  try {
    const filter = parseOSDateFilter(req.query);

    if (filter.error) {
      return res.status(400).json({ error: filter.error });
    }

    const params = filter.params(req.user.company_id);

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
       JOIN clientes c ON c.id = os.cliente_id
       LEFT JOIN users u ON u.id = os.user_id
       WHERE os.company_id = $1
       ${filter.clause}
       ORDER BY os.id DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
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
       JOIN clientes c ON c.id = os.cliente_id
       LEFT JOIN users u ON u.id = os.user_id
       WHERE os.id = $1 AND os.company_id = $2`,
      [id, req.user.company_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/whatsapp-link", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const result = await getWhatsappOSData(id, req.user.company_id);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    const osData = result.rows[0];

    if (!osData.telefone) {
      return res.status(400).json({ error: "Cliente sem telefone" });
    }

    const pecas = await getPecasOS(id, req.user.company_id);
    const telefoneLimpo = sanitizePhoneBR(osData.telefone);
    const mensagem = buildWhatsappMessage(osData, pecas);
    const url = `https://wa.me/${telefoneLimpo}?text=${encodeURIComponent(mensagem)}`;

    res.json({ whatsapp_url: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const {
      cliente_id,
      problema_relatado,
      mao_obra = 0,
      valor_pecas = 0,
      placa = null,
      modelo = null,
    } = req.body;

    const cid = Number(cliente_id);
    const problema = String(problema_relatado || "").trim();
    const mao = Number(mao_obra);
    const pecas = Number(valor_pecas);

    if (!Number.isFinite(cid)) {
      return res.status(400).json({ error: "cliente_id inválido" });
    }

    if (!problema) {
      return res.status(400).json({ error: "problema_relatado é obrigatório" });
    }

    if (!Number.isFinite(mao) || mao < 0) {
      return res.status(400).json({ error: "mao_obra inválido" });
    }

    if (!Number.isFinite(pecas) || pecas < 0) {
      return res.status(400).json({ error: "valor_pecas inválido" });
    }

    const cliente = await pool.query(
      "SELECT id FROM clientes WHERE id = $1 AND company_id = $2",
      [cid, req.user.company_id]
    );

    if (cliente.rowCount === 0) {
      return res.status(400).json({ error: "Cliente não pertence à sua empresa" });
    }

    const total = mao + pecas;

    const result = await pool.query(
      `INSERT INTO ordens_servico
       (cliente_id, placa, modelo, problema_relatado,
        mao_obra, valor_pecas, valor_total,
        status, user_id, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'triagem',$8,$9)
       RETURNING *`,
      [
        cid,
        placa,
        modelo,
        problema,
        mao,
        pecas,
        total,
        req.user.id,
        req.user.company_id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const { status, mao_obra, problema_relatado, modelo, placa } = req.body;
    if (req.user.role === "tecnico") {
      const camposEnviados = Object.keys(req.body);
      const camposPermitidos = ["status", "problema_relatado"];
      const campoInvalido = camposEnviados.find((campo) => !camposPermitidos.includes(campo));

      if (campoInvalido) {
        return res.status(403).json({
          error: "Técnico só pode alterar descrição do serviço e status.",
        });
      }
    }

    if (status && !allowedStatus.includes(status)) {
      return res.status(400).json({ error: "status inválido" });
    }

    const current = await pool.query(
      `SELECT mao_obra, valor_pecas, status
       FROM ordens_servico
       WHERE id = $1 AND company_id = $2`,
      [id, req.user.company_id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    const cur = current.rows[0];

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
           WHEN COALESCE($4, status) IN ('encerrado','finalizado')
           THEN COALESCE(closed_at, now())
           ELSE NULL
         END
       WHERE id = $7 AND company_id = $8
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

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const result = await pool.query(
      "DELETE FROM ordens_servico WHERE id=$1 AND company_id=$2 RETURNING *",
      [id, req.user.company_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/enviar-orcamento", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const result = await getWhatsappOSData(id, req.user.company_id);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    const osData = result.rows[0];

    if (!osData.telefone) {
      return res.status(400).json({ error: "Cliente sem telefone" });
    }

    const targetStatus = "aguardando_aprovacao";

    if (osData.status !== targetStatus) {
      await pool.query(
        `UPDATE ordens_servico
         SET status = $3, updated_at = now()
         WHERE id = $1 AND company_id = $2`,
        [id, req.user.company_id, targetStatus]
      );
      osData.status = targetStatus;
    }

    const pecas = await getPecasOS(id, req.user.company_id);
    const telefoneLimpo = sanitizePhoneBR(osData.telefone);
    const mensagem = buildWhatsappMessage(osData, pecas);
    const url = `https://wa.me/${telefoneLimpo}?text=${encodeURIComponent(mensagem)}`;

    res.json({ whatsapp_url: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/pecas", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const osCheck = await pool.query(
      "SELECT id FROM ordens_servico WHERE id = $1 AND company_id = $2",
      [id, req.user.company_id]
    );

    if (osCheck.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    const result = await pool.query(
      `SELECT id, nome, quantidade, valor_unitario, valor_total, created_at
       FROM os_pecas
       WHERE os_id = $1 AND company_id = $2
       ORDER BY id DESC`,
      [id, req.user.company_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/pecas", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const nome = String(req.body.nome || "").trim();
    const quantidade = Number(req.body.quantidade ?? 1);
    const valor_unitario = Number(req.body.valor_unitario ?? 0);

    if (!nome) {
      return res.status(400).json({ error: "nome é obrigatório" });
    }

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ error: "quantidade inválida" });
    }

    if (!Number.isFinite(valor_unitario) || valor_unitario < 0) {
      return res.status(400).json({ error: "valor_unitario inválido" });
    }

    const osCheck = await pool.query(
      "SELECT id FROM ordens_servico WHERE id = $1 AND company_id = $2",
      [id, req.user.company_id]
    );

    if (osCheck.rowCount === 0) {
      return res.status(404).json({ error: "OS não encontrada" });
    }

    const result = await pool.query(
      `INSERT INTO os_pecas (os_id, company_id, nome, quantidade, valor_unitario)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, quantidade, valor_unitario, valor_total, created_at`,
      [id, req.user.company_id, nome, quantidade, valor_unitario]
    );

    await recalcularTotaisOS(id, req.user.company_id);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id/pecas/:pecaId", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pecaId = Number(req.params.pecaId);

    if (!Number.isFinite(id) || !Number.isFinite(pecaId)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const nome = String(req.body.nome || "").trim();
    const quantidade = Number(req.body.quantidade);
    const valor_unitario = Number(req.body.valor_unitario);

    if (!nome) {
      return res.status(400).json({ error: "nome é obrigatório" });
    }

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ error: "quantidade inválida" });
    }

    if (!Number.isFinite(valor_unitario) || valor_unitario < 0) {
      return res.status(400).json({ error: "valor_unitario inválido" });
    }

    const result = await pool.query(
      `UPDATE os_pecas
       SET nome = $1,
           quantidade = $2,
           valor_unitario = $3
       WHERE id = $4 AND os_id = $5 AND company_id = $6
       RETURNING id, nome, quantidade, valor_unitario, valor_total, created_at`,
      [nome, quantidade, valor_unitario, pecaId, id, req.user.company_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Peça não encontrada" });
    }

    await recalcularTotaisOS(id, req.user.company_id);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/pecas/:pecaId", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pecaId = Number(req.params.pecaId);

    if (!Number.isFinite(id) || !Number.isFinite(pecaId)) {
      return res.status(400).json({ error: "id inválido" });
    }

    const result = await pool.query(
      `DELETE FROM os_pecas
       WHERE id = $1 AND os_id = $2 AND company_id = $3
       RETURNING *`,
      [pecaId, id, req.user.company_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Peça não encontrada" });
    }

    await recalcularTotaisOS(id, req.user.company_id);

    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
