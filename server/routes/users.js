const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");

const router = express.Router();

router.use(authRequired, loadUser);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizarEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function limparTexto(value) {
  return String(value || "").trim();
}

function gerarInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

function gerarSenhaTemporaria() {
  return crypto.randomBytes(24).toString("hex");
}

function montarInviteLink(token) {
  const baseUrl =
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    "http://localhost:5173";

  return `${baseUrl.replace(/\/$/, "")}/ativar-conta?token=${token}`;
}

// GET /users
router.get("/", requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         name,
         email,
         role,
         company_id,
         is_active,
         invite_token,
         invite_expires_at,
         activated_at,
         invited_by,
         created_at
       FROM users
       WHERE company_id = $1
       ORDER BY id ASC`,
      [req.user.company_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /users/invite
router.post("/invite", requireRole("admin"), async (req, res) => {
  try {
    const name = limparTexto(req.body.name);
    const email = normalizarEmail(req.body.email);
    const role = limparTexto(req.body.role) || "member";

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Nome obrigatório" });
    }

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    if (!["admin", "member"].includes(role)) {
      return res.status(400).json({ error: "Role inválida" });
    }

    const exists = await pool.query(
      `SELECT id, company_id, is_active
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (exists.rowCount > 0) {
      return res.status(409).json({ error: "Email já cadastrado" });
    }

    const inviteToken = gerarInviteToken();
    const inviteExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h
    const senhaTemporaria = gerarSenhaTemporaria();
    const passwordHash = await bcrypt.hash(senhaTemporaria, 10);

    const inserted = await pool.query(
      `INSERT INTO users (
         name,
         email,
         password_hash,
         company_id,
         role,
         is_active,
         invite_token,
         invite_expires_at,
         invited_by
       )
       VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8)
       RETURNING
         id,
         name,
         email,
         role,
         company_id,
         is_active,
         invite_token,
         invite_expires_at,
         invited_by,
         created_at`,
      [
        name,
        email,
        passwordHash,
        req.user.company_id,
        role,
        inviteToken,
        inviteExpiresAt,
        req.user.id,
      ]
    );

    const user = inserted.rows[0];
    const inviteLink = montarInviteLink(inviteToken);
    const whatsappText = encodeURIComponent(
      `Olá, ${user.name}.\n\n` +
      `Você foi convidado para acessar o sistema da oficina.\n\n` +
      `Ative sua conta pelo link:\n${inviteLink}\n\n` +
      `Este link é válido por 72 horas.`
    );

    res.status(201).json({
      message: "Usuário convidado com sucesso",
      user,
      invite_link: inviteLink,
      whatsapp_link: `https://wa.me/?text=${whatsappText}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;