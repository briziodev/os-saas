const express = require("express");
const router = express.Router();
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const validate = require("../middlewares/validate");
const {
  clienteIdParamSchema,
  clienteSchema,
} = require("../validators/clienteSchemas");

router.use(authRequired, loadUser);

// GET /clientes
router.get("/", requireRole("admin", "atendimento"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM clientes WHERE company_id = $1 ORDER BY id ASC",
      [req.user.company_id]
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /clientes
router.post(
  "/",
  requireRole("admin", "atendimento"),
  validate(clienteSchema),
  async (req, res) => {
    try {
      const { nome, email, telefone } = req.body;

      const result = await pool.query(
        `
        INSERT INTO clientes (nome, email, telefone, user_id, company_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          nome,
          email,
          telefone,
          req.user.id,
          req.user.company_id,
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// PUT /clientes/:id
router.put(
  "/:id",
  requireRole("admin", "atendimento"),
  validate(clienteIdParamSchema, "params"),
  validate(clienteSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { nome, email, telefone } = req.body;

      const result = await pool.query(
        `
        UPDATE clientes
        SET nome = $1, email = $2, telefone = $3
        WHERE id = $4 AND company_id = $5
        RETURNING *
        `,
        [nome, email, telefone, id, req.user.company_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Cliente não encontrado (ou não pertence à sua empresa)",
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /clientes/:id
router.delete(
  "/:id",
  requireRole("admin"),
  validate(clienteIdParamSchema, "params"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        "DELETE FROM clientes WHERE id = $1 AND company_id = $2 RETURNING *",
        [id, req.user.company_id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Cliente não encontrado (ou não pertence à sua empresa)",
        });
      }

      return res.json({ deleted: result.rows[0] });
    } catch (err) {
      if (err.code === "23503") {
        return res.status(409).json({
          error:
            "Não é possível excluir este cliente porque ele possui ordens de serviço vinculadas.",
        });
      }

      return res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;