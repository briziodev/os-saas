const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const pool = require("../db");

// POST /auth/register
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  const nameClean = String(name || "").trim();
  const emailClean = String(email || "").trim().toLowerCase();
  const passwordClean = String(password || "");

  if (!emailClean) return res.status(400).json({ error: "email é obrigatório" });
  if (!emailClean.includes("@")) return res.status(400).json({ error: "email inválido" });
  if (!passwordClean || passwordClean.length < 6)
    return res.status(400).json({ error: "senha precisa ter no mínimo 6 caracteres" });

  try {
    // verifica se já existe
    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [emailClean]);
    if (exists.rowCount > 0) return res.status(409).json({ error: "email já cadastrado" });

    const passwordHash = await bcrypt.hash(passwordClean, 10);

    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at",
      [nameClean || null, emailClean, passwordHash]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;