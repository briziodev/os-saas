const {
  loginLimiter,
  passwordChangeLimiter,
} = require("../middlewares/rateLimiters");
const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const { signAuthToken } = require("../utils/authToken");
const { authRequired, loadUser } = require("../middlewares/auth");
const validate = require("../middlewares/validate");
const {
  loginSchema,
  activateAccountSchema,
  changePasswordSchema,
} = require("../validators/authSchemas");
const { logger, maskEmail, maskToken } = require("../utils/logger");
const {
  BCRYPT_ROUNDS,
} = require("../utils/passwordPolicy");

const ALLOWED_ROLES = ["admin", "atendimento", "tecnico"];

function limparTexto(value) {
  return String(value || "").trim();
}

// REGISTER DESATIVADO
// O SaaS agora usa fluxo oficial de convite.
// Não permitir cadastro público para evitar usuários sem empresa/company_id.
router.post("/register", async (req, res) => {
  logger.warn("PUBLIC_REGISTER_BLOCKED", "Tentativa de cadastro público bloqueada", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });

  return res.status(403).json({
    error: "Cadastro público desativado. Use o fluxo de convite.",
  });
});

// LOGIN
router.post("/login", loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const emailNormalizado = String(email || "").trim().toLowerCase();

    const result = await pool.query(
      `SELECT
         id,
         name,
         email,
         password_hash,
         company_id,
         role,
         is_active,
         session_version
       FROM users
       WHERE email = $1`,
      [emailNormalizado]
    );

    if (result.rowCount === 0) {
      logger.warn("LOGIN_FAILED", "Falha de login: usuário não encontrado", {
        requestId: req.requestId,
        email: maskEmail(emailNormalizado),
        ip: req.ip,
      });

      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      logger.warn("LOGIN_BLOCKED_INACTIVE_USER", "Login bloqueado: usuário inativo", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(403).json({ error: "Sua conta ainda não foi ativada" });
    }

    if (!user.company_id) {
      logger.warn("LOGIN_BLOCKED_WITHOUT_COMPANY", "Login bloqueado: usuário sem empresa vinculada", {
        requestId: req.requestId,
        userId: user.id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(403).json({
        error: "Usuário sem empresa vinculada. Acesse pelo fluxo de convite.",
      });
    }

    if (!ALLOWED_ROLES.includes(user.role)) {
      logger.warn("LOGIN_BLOCKED_INVALID_ROLE", "Login bloqueado: perfil inválido", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(403).json({
        error: "Perfil de usuário inválido.",
      });
    }

    const senhaCorreta = await bcrypt.compare(password, user.password_hash);

    if (!senhaCorreta) {
      logger.warn("LOGIN_FAILED", "Falha de login: senha inválida", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = signAuthToken(user);

    logger.info("LOGIN_SUCCESS", "Usuário autenticado com sucesso", {
      requestId: req.requestId,
      userId: user.id,
      companyId: user.company_id,
      role: user.role,
      email: maskEmail(user.email),
      ip: req.ip,
    });

    return res.json({
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
    return next(err);
  }
});

// GET /auth/me
router.get("/me", authRequired, loadUser, async (req, res, next) => {
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
    return next(err);
  }
});

// POST /auth/change-password
router.post(
  "/change-password",
  authRequired,
  loadUser,
  passwordChangeLimiter,
  validate(changePasswordSchema),
  async (req, res, next) => {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      const {
        currentPassword,
        newPassword,
      } = req.body;

      await client.query("BEGIN");
      transactionOpen = true;

      const lockedUserResult = await client.query(
        `SELECT
           id,
           name,
           email,
           password_hash,
           company_id,
           role,
           is_active,
           session_version
         FROM users
         WHERE id = $1
           AND company_id = $2
           AND session_version = $3
         FOR UPDATE`,
        [
          req.user.id,
          req.user.company_id,
          req.user.session_version,
        ]
      );

      if (lockedUserResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        logger.warn(
          "PASSWORD_CHANGE_FAILED",
          "Alteração de senha bloqueada: usuário não encontrado",
          {
            requestId: req.requestId,
            userId: req.user.id,
            companyId: req.user.company_id,
            role: req.user.role,
            reason: "stale_or_missing_session",
            ip: req.ip,
          }
        );

        return res.status(401).json({
          error:
            "Sessão inválida. Faça login novamente.",
          requestId: req.requestId,
        });
      }

      const user = lockedUserResult.rows[0];

      if (!user.is_active) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        logger.warn(
          "PASSWORD_CHANGE_FAILED",
          "Alteração de senha bloqueada: usuário inativo",
          {
            requestId: req.requestId,
            userId: user.id,
            companyId: user.company_id,
            role: user.role,
            reason: "inactive_user",
            ip: req.ip,
          }
        );

        return res.status(403).json({
          error: "Usuário inativo.",
          requestId: req.requestId,
        });
      }

      const currentPasswordMatches =
        await bcrypt.compare(
          currentPassword,
          user.password_hash
        );

      if (!currentPasswordMatches) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        logger.warn(
          "PASSWORD_CHANGE_FAILED",
          "Alteração de senha bloqueada: senha atual inválida",
          {
            requestId: req.requestId,
            userId: user.id,
            companyId: user.company_id,
            role: user.role,
            reason: "invalid_current_password",
            ip: req.ip,
          }
        );

        return res.status(400).json({
          error: "Senha atual incorreta.",
          requestId: req.requestId,
        });
      }

      const reusesCurrentPassword =
        await bcrypt.compare(
          newPassword,
          user.password_hash
        );

      if (reusesCurrentPassword) {
        await client.query("ROLLBACK");
        transactionOpen = false;

        logger.warn(
          "PASSWORD_CHANGE_FAILED",
          "Alteração de senha bloqueada: reutilização da senha atual",
          {
            requestId: req.requestId,
            userId: user.id,
            companyId: user.company_id,
            role: user.role,
            reason: "password_reuse",
            ip: req.ip,
          }
        );

        return res.status(409).json({
          error:
            "A nova senha deve ser diferente da senha atual.",
          requestId: req.requestId,
        });
      }

      const newPasswordHash = await bcrypt.hash(
        newPassword,
        BCRYPT_ROUNDS
      );

      const updatedUserResult = await client.query(
        `UPDATE users
         SET
           password_hash = $1,
           password_changed_at = NOW(),
           session_version = session_version + 1
         WHERE id = $2
           AND company_id = $3
         RETURNING
           id,
           name,
           email,
           company_id,
           role,
           is_active,
           session_version,
           password_changed_at`,
        [
          newPasswordHash,
          user.id,
          user.company_id,
        ]
      );

      const revokedTokensResult = await client.query(
        `UPDATE password_reset_tokens
         SET revoked_at = NOW()
         WHERE user_id = $1
           AND used_at IS NULL
           AND revoked_at IS NULL
         RETURNING id`,
        [user.id]
      );

      const updatedUser = updatedUserResult.rows[0];

      const token = signAuthToken(updatedUser);

      await client.query("COMMIT");
      transactionOpen = false;

      logger.info(
        "PASSWORD_CHANGE_COMPLETED",
        "Senha alterada com sucesso",
        {
          requestId: req.requestId,
          userId: updatedUser.id,
          companyId: updatedUser.company_id,
          role: updatedUser.role,
          previousSessionVersion:
            user.session_version,
          currentSessionVersion:
            updatedUser.session_version,
          revokedResetTokens:
            revokedTokensResult.rowCount,
          ip: req.ip,
        }
      );

      logger.info(
        "SESSIONS_REVOKED",
        "Sessões anteriores revogadas após alteração de senha",
        {
          requestId: req.requestId,
          userId: updatedUser.id,
          companyId: updatedUser.company_id,
          role: updatedUser.role,
          previousSessionVersion:
            user.session_version,
          currentSessionVersion:
            updatedUser.session_version,
          ip: req.ip,
        }
      );

      return res.json({
        message: "Senha alterada com sucesso.",
        token,
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          company_id: updatedUser.company_id,
          role: updatedUser.role,
          is_active: updatedUser.is_active,
        },
      });
    } catch (err) {
      if (transactionOpen) {
        await client
          .query("ROLLBACK")
          .catch(() => {});
      }

      return next(err);
    } finally {
      client.release();
    }
  }
);

// GET /auth/invite/:token
router.get("/invite/:token", async (req, res, next) => {
  try {
    const token = limparTexto(req.params.token);

    if (!token) {
      logger.warn("INVITE_VALIDATE_FAILED", "Validação de convite sem token", {
        requestId: req.requestId,
        ip: req.ip,
      });

      return res.status(400).json({ error: "Token inválido" });
    }

    const result = await pool.query(
      `SELECT id, name, email, role, company_id, is_active, invite_expires_at
       FROM users
       WHERE invite_token = $1`,
      [token]
    );

    if (result.rowCount === 0) {
      logger.warn("INVITE_VALIDATE_FAILED", "Convite inválido consultado", {
        requestId: req.requestId,
        token: maskToken(token),
        ip: req.ip,
      });

      return res.status(404).json({ error: "Convite inválido" });
    }

    const user = result.rows[0];

    if (user.is_active) {
      logger.warn("INVITE_VALIDATE_ALREADY_ACTIVE", "Convite consultado para conta já ativa", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(400).json({ error: "Esta conta já foi ativada" });
    }

    if (!user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
      logger.warn("INVITE_VALIDATE_EXPIRED", "Convite expirado consultado", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(400).json({ error: "Este convite expirou" });
    }

    logger.info("INVITE_VALIDATE_SUCCESS", "Convite validado com sucesso", {
      requestId: req.requestId,
      userId: user.id,
      companyId: user.company_id,
      role: user.role,
      email: maskEmail(user.email),
      ip: req.ip,
    });

    return res.json({
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
    return next(err);
  }
});

// POST /auth/activate
router.post("/activate", validate(activateAccountSchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const result = await pool.query(
      `SELECT id, email, is_active, invite_expires_at, company_id, role
       FROM users
       WHERE invite_token = $1`,
      [token]
    );

    if (result.rowCount === 0) {
      logger.warn("ACCOUNT_ACTIVATE_FAILED", "Ativação falhou: convite inválido", {
        requestId: req.requestId,
        token: maskToken(token),
        ip: req.ip,
      });

      return res.status(404).json({ error: "Convite inválido" });
    }

    const user = result.rows[0];

    if (user.is_active) {
      logger.warn("ACCOUNT_ACTIVATE_ALREADY_ACTIVE", "Ativação falhou: conta já ativa", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(400).json({ error: "Esta conta já foi ativada" });
    }

    if (!user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
      logger.warn("ACCOUNT_ACTIVATE_EXPIRED", "Ativação falhou: convite expirado", {
        requestId: req.requestId,
        userId: user.id,
        companyId: user.company_id,
        role: user.role,
        email: maskEmail(user.email),
        ip: req.ip,
      });

      return res.status(400).json({ error: "Este convite expirou" });
    }

    const passwordHash = await bcrypt.hash(
      password,
      BCRYPT_ROUNDS
    );

    const updated = await pool.query(
      `UPDATE users
       SET
         password_hash = $1,
         is_active = true,
         activated_at = now(),
         password_changed_at = now(),
         invite_token = NULL,
         invite_expires_at = NULL
       WHERE id = $2
       RETURNING id, name, email, company_id, role, is_active, activated_at`,
      [passwordHash, user.id]
    );

    logger.info("ACCOUNT_ACTIVATED", "Conta ativada com sucesso", {
      requestId: req.requestId,
      userId: updated.rows[0].id,
      companyId: updated.rows[0].company_id,
      role: updated.rows[0].role,
      email: maskEmail(updated.rows[0].email),
      ip: req.ip,
    });

    return res.json({
      message: "Conta ativada com sucesso",
      user: updated.rows[0],
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;