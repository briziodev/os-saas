const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const { authRequired, loadUser } = require("../middlewares/auth");
const { requireRole } = require("../middlewares/requireRole");
const validate = require("../middlewares/validate");
const {
  userIdParamSchema,
  inviteUserSchema,
  updateUserRoleSchema,
} = require("../validators/userSchemas");
const { logger, maskEmail } = require("../utils/logger");

const router = express.Router();

router.use(authRequired, loadUser);

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

function getTargetId(req) {
  return Number(req.params.id);
}

// GET /users
router.get("/", requireRole("admin"), async (req, res, next) => {
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

    return res.json(result.rows);
  } catch (err) {
    return next(err);
  }
});

// POST /users/invite
router.post(
  "/invite",
  requireRole("admin"),
  validate(inviteUserSchema),
  async (req, res, next) => {
    try {
      const { name, role, phone } = req.body;
      const email = String(req.body.email || "").trim().toLowerCase();

      const exists = await pool.query(
        `SELECT id, company_id, is_active
         FROM users
         WHERE email = $1`,
        [email]
      );

      if (exists.rowCount > 0) {
        logger.warn("USER_INVITE_DUPLICATE_EMAIL", "Tentativa de convite com email já cadastrado", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          targetEmail: maskEmail(email),
          existingUserId: exists.rows[0].id,
          existingCompanyId: exists.rows[0].company_id,
          ip: req.ip,
        });

        return res.status(409).json({
          error: "Email já cadastrado",
          requestId: req.requestId,
        });
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

      logger.info("USER_INVITE_CREATED", "Convite de usuário criado", {
        requestId: req.requestId,
        adminUserId: req.user.id,
        companyId: req.user.company_id,
        invitedUserId: user.id,
        invitedEmail: maskEmail(user.email),
        invitedRole: user.role,
        hasPhone: Boolean(user.phone),
        inviteExpiresAt: user.invite_expires_at,
        ip: req.ip,
      });

      return res.status(201).json({
        message: "Usuário convidado com sucesso",
        user,
        invite_link: inviteLink,
        whatsapp_link: whatsappLink,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// PATCH /users/:id/role
router.patch(
  "/:id/role",
  requireRole("admin"),
  validate(userIdParamSchema, "params"),
  validate(updateUserRoleSchema),
  async (req, res, next) => {
    try {
      const targetId = getTargetId(req);
      const { role } = req.body;

      if (req.user.id === targetId) {
        logger.warn("USER_ROLE_CHANGE_BLOCKED_SELF", "Admin tentou alterar o próprio perfil", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          attemptedRole: role,
          ip: req.ip,
        });

        return res.status(403).json({
          error: "Você não pode alterar o próprio perfil.",
          requestId: req.requestId,
        });
      }

      const currentUser = await pool.query(
        `SELECT id, email, role, company_id
         FROM users
         WHERE id = $1 AND company_id = $2`,
        [targetId, req.user.company_id]
      );

      if (currentUser.rowCount === 0) {
        logger.warn("USER_ROLE_CHANGE_TARGET_NOT_FOUND", "Tentativa de alterar perfil de usuário inexistente", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          targetUserId: targetId,
          attemptedRole: role,
          ip: req.ip,
        });

        return res.status(404).json({
          error: "Usuário não encontrado",
          requestId: req.requestId,
        });
      }

      const targetUser = currentUser.rows[0];

      await pool.query(
        `UPDATE users
         SET role = $1
         WHERE id = $2 AND company_id = $3`,
        [role, targetId, req.user.company_id]
      );

      logger.info("USER_ROLE_UPDATED", "Perfil de usuário atualizado", {
        requestId: req.requestId,
        adminUserId: req.user.id,
        companyId: req.user.company_id,
        targetUserId: targetUser.id,
        targetEmail: maskEmail(targetUser.email),
        oldRole: targetUser.role,
        newRole: role,
        ip: req.ip,
      });

      return res.json({
        message: "Perfil atualizado",
        requestId: req.requestId,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// PATCH /users/:id/toggle-active
router.patch(
  "/:id/toggle-active",
  requireRole("admin"),
  validate(userIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const targetId = getTargetId(req);

      if (req.user.id === targetId) {
        logger.warn("USER_STATUS_CHANGE_BLOCKED_SELF", "Admin tentou alterar a própria conta", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          ip: req.ip,
        });

        return res.status(403).json({
          error: "Você não pode alterar sua própria conta.",
          requestId: req.requestId,
        });
      }

      const user = await pool.query(
        `SELECT id, email, role, is_active
         FROM users
         WHERE id = $1 AND company_id = $2`,
        [targetId, req.user.company_id]
      );

      if (user.rowCount === 0) {
        logger.warn("USER_STATUS_CHANGE_TARGET_NOT_FOUND", "Tentativa de alterar status de usuário inexistente", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          targetUserId: targetId,
          ip: req.ip,
        });

        return res.status(404).json({
          error: "Usuário não encontrado",
          requestId: req.requestId,
        });
      }

      const targetUser = user.rows[0];
      const oldStatus = targetUser.is_active;
      const newStatus = !targetUser.is_active;

      await pool.query(
        `UPDATE users
         SET is_active = $1
         WHERE id = $2 AND company_id = $3`,
        [newStatus, targetId, req.user.company_id]
      );

      logger.info("USER_STATUS_UPDATED", "Status de usuário atualizado", {
        requestId: req.requestId,
        adminUserId: req.user.id,
        companyId: req.user.company_id,
        targetUserId: targetUser.id,
        targetEmail: maskEmail(targetUser.email),
        targetRole: targetUser.role,
        oldStatus,
        newStatus,
        ip: req.ip,
      });

      return res.json({
        message: "Status atualizado",
        requestId: req.requestId,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /users/:id/resend-invite
router.post(
  "/:id/resend-invite",
  requireRole("admin"),
  validate(userIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const targetId = getTargetId(req);

      if (req.user.id === targetId) {
        logger.warn("USER_INVITE_RESEND_BLOCKED_SELF", "Admin tentou reenviar convite para a própria conta", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          ip: req.ip,
        });

        return res.status(403).json({
          error: "Você não pode reenviar convite para sua própria conta.",
          requestId: req.requestId,
        });
      }

      const targetUser = await pool.query(
        `SELECT id, name, email, role, is_active
         FROM users
         WHERE id = $1 AND company_id = $2`,
        [targetId, req.user.company_id]
      );

      if (targetUser.rowCount === 0) {
        logger.warn("USER_INVITE_RESEND_TARGET_NOT_FOUND", "Tentativa de reenviar convite para usuário inexistente", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          targetUserId: targetId,
          ip: req.ip,
        });

        return res.status(404).json({
          error: "Usuário não encontrado",
          requestId: req.requestId,
        });
      }

      const user = targetUser.rows[0];

      if (user.is_active) {
        logger.warn("USER_INVITE_RESEND_BLOCKED_ACTIVE_USER", "Tentativa de reenviar convite para usuário já ativo", {
          requestId: req.requestId,
          adminUserId: req.user.id,
          companyId: req.user.company_id,
          targetUserId: user.id,
          targetEmail: maskEmail(user.email),
          targetRole: user.role,
          ip: req.ip,
        });

        return res.status(400).json({
          error: "Usuário já está ativo",
          requestId: req.requestId,
        });
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

      logger.info("USER_INVITE_RESENT", "Convite de usuário reenviado", {
        requestId: req.requestId,
        adminUserId: req.user.id,
        companyId: req.user.company_id,
        targetUserId: user.id,
        targetEmail: maskEmail(user.email),
        targetRole: user.role,
        inviteExpiresAt,
        ip: req.ip,
      });

      return res.json({
        message: "Convite reenviado",
        invite_link: inviteLink,
        requestId: req.requestId,
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;