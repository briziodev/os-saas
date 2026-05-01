const { requireRole } = require("../middlewares/requireRole");
const express = require("express");
const router = express.Router();
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");
router.use(authRequired, loadUser);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function limparTexto(value) {
  return String(value || "").trim();
}

function limparTelefone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizarEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validarCliente({ nome, email, telefone }) {
  const nomeLimpo = limparTexto(nome);
  const emailLimpo = normalizarEmail(email);
  const telefoneLimpo = limparTelefone(telefone);

  if (!nomeLimpo) {
    return { error: "nome é obrigatório" };
  }

  if (!telefoneLimpo) {
    return { error: "telefone é obrigatório" };
  }

  if (telefoneLimpo.length < 10) {
    return { error: "telefone inválido" };
  }

  if (emailLimpo && !EMAIL_REGEX.test(emailLimpo)) {
    return { error: "email inválido" };
  }

  return {
    nomeLimpo,
    emailLimpo: emailLimpo || null,
    telefoneLimpo,
  };
}

// GET (por empresa)
router.get("/", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM clientes WHERE company_id = $1 ORDER BY id ASC",
      [req.user.company_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE (por empresa)
router.post("/", requireRole("admin", "atendimento"), async (req, res) => {
  const validacao = validarCliente(req.body);

  if (validacao.error) {
    return res.status(400).json({ error: validacao.error });
  }

  const { nomeLimpo, emailLimpo, telefoneLimpo } = validacao;

  try {
    const result = await pool.query(
      `
      INSERT INTO clientes (nome, email, telefone, user_id, company_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        nomeLimpo,
        emailLimpo,
        telefoneLimpo,
        req.user.id,
        req.user.company_id,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE (só se for da empresa)
router.put("/:id", requireRole("admin", "atendimento"), async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id inválido" });
  }

  const validacao = validarCliente(req.body);

  if (validacao.error) {
    return res.status(400).json({ error: validacao.error });
  }

  const { nomeLimpo, emailLimpo, telefoneLimpo } = validacao;

  try {
    const result = await pool.query(
      `
      UPDATE clientes
      SET nome = $1, email = $2, telefone = $3
      WHERE id = $4 AND company_id = $5
      RETURNING *
      `,
      [nomeLimpo, emailLimpo, telefoneLimpo, id, req.user.company_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Cliente não encontrado (ou não pertence à sua empresa)",
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE (só se for da empresa)
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id inválido" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM clientes WHERE id = $1 AND company_id = $2 RETURNING *",
      [id, req.user.company_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Cliente não encontrado (ou não pertence à sua empresa)",
      });
    }

    res.json({ deleted: result.rows[0] });
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({
        error:
          "Não é possível excluir este cliente porque ele possui ordens de serviço vinculadas.",
      });
    }

    res.status(500).json({ error: err.message });
  }
});

module.exports = router;