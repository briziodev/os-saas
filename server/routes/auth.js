const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { authRequired, loadUser } = require("../middlewares/auth");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function limparTexto(value) {
  return String(value || "").trim();
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

    const inserted = await pool.query(
      `INSERT INTO users (name, email, password_hash, is_active, activated_at)
       VALUES ($1, $2, $3, true, now())
       RETURNING id, name, email, company_id, role, is_active, activated_at, created_at`,
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
      `SELECT
         id,
         name,
         email,
         password_hash,
         company_id,
         role,
         is_active
       FROM users
       WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: "Sua conta ainda não foi ativada" });
    }

    const senhaCorreta = await bcrypt.compare(password, user.password_hash);

    if (!senhaCorreta) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        company_id: user.company_id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company_id: user.company_id,
        role: user.role,
        is_active: user.is_active,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me
router.get("/me", authRequired, loadUser, async (req, res) => {
  try {
    return res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      company_id: req.user.company_id,
      role: req.user.role,
      is_active: req.user.is_active,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});




// GET /auth/invite/:token
router.get("/invite/:token", async (req, res) => {
  try {
    const token = limparTexto(req.params.token);

    if (!token) {
      return res.status(400).json({ error: "Token inválido" });
    }

    const result = await pool.query(
      `SELECT id, name, email, role, company_id, is_active, invite_expires_at
       FROM users
       WHERE invite_token = $1`,
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Convite inválido" });
    }

    const user = result.rows[0];

    if (user.is_active) {
      return res.status(400).json({ error: "Esta conta já foi ativada" });
    }

    if (!user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
      return res.status(400).json({ error: "Este convite expirou" });
    }

    res.json({
      valid: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
      },
      expires_at: user.invite_expires_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/activate
router.post("/activate", async (req, res) => {
  try {
    const token = limparTexto(req.body.token);
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!token) {
      return res.status(400).json({ error: "Token obrigatório" });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Senha mínimo 6 caracteres" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "As senhas não coincidem" });
    }

    const result = await pool.query(
      `SELECT id, email, is_active, invite_expires_at
       FROM users
       WHERE invite_token = $1`,
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Convite inválido" });
    }

    const user = result.rows[0];

    if (user.is_active) {
      return res.status(400).json({ error: "Esta conta já foi ativada" });
    }

    if (!user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
      return res.status(400).json({ error: "Este convite expirou" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const updated = await pool.query(
      `UPDATE users
       SET
         password_hash = $1,
         is_active = true,
         activated_at = now(),
         invite_token = NULL,
         invite_expires_at = NULL
       WHERE id = $2
       RETURNING id, name, email, company_id, role, is_active, activated_at`,
      [passwordHash, user.id]
    );

    res.json({
      message: "Conta ativada com sucesso",
      user: updated.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;