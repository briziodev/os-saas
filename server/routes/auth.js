const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: "Nome obrigatório" });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Senha mínimo 6 caracteres" });
    }

    const exists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (exists.rowCount > 0) {
      return res.status(409).json({ error: "Email já cadastrado" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // ✅ INSERE de verdade (role default no banco = member, company_id pode ser null)
    const inserted = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, company_id, role, created_at`,
      [name.trim(), email.toLowerCase(), password_hash]
    );

    return res.status(201).json(inserted.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email e senha obrigatórios" });
    }

const result = await pool.query(
  "SELECT id, name, email, password_hash, company_id, role FROM users WHERE email = $1",
  [email.toLowerCase()]
);
    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = result.rows[0];

    const senhaCorreta = await bcrypt.compare(password, user.password_hash);

    if (!senhaCorreta) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }
const token = jwt.sign(
  { 
    id: user.id, 
    email: user.email, 
    company_id: user.company_id,
    role: user.role
  },
  process.env.JWT_SECRET,
  { expiresIn: "7d" }
);

res.json({
  token,
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    company_id: user.company_id,
    role: user.role
  }
});

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;