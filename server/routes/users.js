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

function normalizarTelefone(value) {
  return String(value || "").replace(/\D/g, "");
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
         phone,
         role,
         company_id,
        is_active,
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
    const role = limparTexto(req.body.role) || "atendimento";
    const phone = normalizarTelefone(req.body.phone);

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Nome obrigatório" });
    }

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    if (!["atendimento", "tecnico"].includes(role)) {
      return res.status(400).json({ error: "Perfil inválido" });
    }

    if (phone && phone.length < 10) {
      return res.status(400).json({ error: "Telefone inválido" });
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
    const inviteExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const senhaTemporaria = gerarSenhaTemporaria();
    const passwordHash = await bcrypt.hash(senhaTemporaria, 10);

    const inserted = await pool.query(
  `INSERT INTO users (
     name,
     email,
     phone,
     password_hash,
     company_id,
     role,
     is_active,
     invite_token,
     invite_expires_at,
     invited_by
   )
   VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9)
   RETURNING
     id,
     name,
     email,
     phone,
     role,
     company_id,
     is_active,
     invite_expires_at,
     invited_by,
     created_at`,
  [
    name,
    email,
    phone || null,
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

    const whatsappLink = phone
      ? `https://wa.me/55${phone}?text=${whatsappText}`
      : null;

    res.status(201).json({
      message: "Usuário convidado com sucesso",
      user,
      invite_link: inviteLink,
      whatsapp_link: whatsappLink,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /users/:id/role
router.patch("/:id/role", requireRole("admin"), async (req, res) => {
  try {
    const { role } = req.body;
    const targetId = Number(req.params.id);

    if (!["atendimento", "tecnico"].includes(role)) {
      return res.status(400).json({ error: "Perfil inválido" });
    }

    if (!Number.isInteger(targetId)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    if (req.user.id === targetId) {
      return res.status(403).json({
        error: "Você não pode alterar o próprio perfil.",
      });
    }

    const updated = await pool.query(
      `UPDATE users
       SET role = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id`,
      [role, targetId, req.user.company_id]
    );

    if (updated.rowCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    res.json({ message: "Perfil atualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /users/:id/toggle-active
router.patch("/:id/toggle-active", requireRole("admin"), async (req, res) => {
  try {
    const targetId = Number(req.params.id);

    if (!Number.isInteger(targetId)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    if (req.user.id === targetId) {
      return res.status(403).json({
        error: "Você não pode alterar sua própria conta.",
      });
    }

    const user = await pool.query(
      `SELECT id, role, is_active
       FROM users
       WHERE id = $1 AND company_id = $2`,
      [targetId, req.user.company_id]
    );

    if (user.rowCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const targetUser = user.rows[0];
    const newStatus = !targetUser.is_active;

    await pool.query(
      `UPDATE users
       SET is_active = $1
       WHERE id = $2 AND company_id = $3`,
      [newStatus, targetId, req.user.company_id]
    );

    res.json({ message: "Status atualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /users/:id/resend-invite
router.post("/:id/resend-invite", requireRole("admin"), async (req, res) => {
  try {
    const targetId = Number(req.params.id);

    if (!Number.isInteger(targetId)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    if (req.user.id === targetId) {
      return res.status(403).json({
        error: "Você não pode reenviar convite para sua própria conta.",
      });
    }

    const targetUser = await pool.query(
      `SELECT id, name, is_active
       FROM users
       WHERE id = $1 AND company_id = $2`,
      [targetId, req.user.company_id]
    );

    if (targetUser.rowCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    if (targetUser.rows[0].is_active) {
      return res.status(400).json({ error: "Usuário já está ativo" });
    }

    const inviteToken = gerarInviteToken();
    const inviteExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET invite_token = $1,
           invite_expires_at = $2
       WHERE id = $3 AND company_id = $4`,
      [inviteToken, inviteExpiresAt, targetId, req.user.company_id]
    );

    const inviteLink = montarInviteLink(inviteToken);

    res.json({
      message: "Convite reenviado",
      invite_link: inviteLink,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
