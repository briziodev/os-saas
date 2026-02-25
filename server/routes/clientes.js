const express = require("express");
const router = express.Router();
const pool = require("../db");




router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clientes ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ CREATE (email obrigatório)
router.post("/", async (req, res) => {
  const { nome, email, telefone } = req.body;

  const nomeLimpo = String(nome || "").trim();
  const emailLimpo = String(email || "").trim();
  const telefoneLimpo = String(telefone || "").replace(/\D/g, "");

  // validação
  if (!nomeLimpo) return res.status(400).json({ error: "nome é obrigatório" });
  if (!emailLimpo) return res.status(400).json({ error: "email é obrigatório" });
  if (!emailLimpo.includes("@")) return res.status(400).json({ error: "email inválido" });

  // telefone é opcional, mas se vier tem que ter pelo menos 10 dígitos
  if (telefone && telefoneLimpo.length > 0 && telefoneLimpo.length < 10) {
    return res.status(400).json({ error: "telefone inválido" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO clientes (nome, email, telefone) VALUES ($1, $2, $3) RETURNING *",
      [nomeLimpo, emailLimpo, telefoneLimpo || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UPDATE (email obrigatório)
router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { nome, email, telefone } = req.body;

  const nomeLimpo = String(nome || "").trim();
  const emailLimpo = String(email || "").trim();
  const telefoneLimpo = String(telefone || "").replace(/\D/g, "");

  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
  if (!nomeLimpo) return res.status(400).json({ error: "nome é obrigatório" });
  if (!emailLimpo) return res.status(400).json({ error: "email é obrigatório" });
  if (!emailLimpo.includes("@")) return res.status(400).json({ error: "email inválido" });

  if (telefone && telefoneLimpo.length > 0 && telefoneLimpo.length < 10) {
    return res.status(400).json({ error: "telefone :(  inválido" });
  }

  try {
    const result = await pool.query(
      `UPDATE clientes
       SET nome = $1, email = $2, telefone = $3
       WHERE id = $4
       RETURNING *`,
      [nomeLimpo, emailLimpo, telefoneLimpo || null, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ DELETE
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  try {
    const result = await pool.query("DELETE FROM clientes WHERE id = $1 RETURNING *", [id]);

    if (result.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;