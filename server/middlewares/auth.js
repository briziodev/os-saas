const jwt = require("jsonwebtoken");
const pool = require("../db");
const { logger, maskEmail } = require("../utils/logger");

const ALLOWED_ROLES = ["admin", "atendimento", "tecnico"];

function getBearerToken(header) {
  if (!header) return null;

  const parts = String(header).trim().split(" ");

  if (parts.length !== 2) return null;

  const [scheme, token] = parts;

  if (scheme !== "Bearer") return null;

  if (!token || token === "null" || token === "undefined") return null;

  return token;
}

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  const token = getBearerToken(header);

  if (!header) {
    logger.warn("TOKEN_MISSING", "Acesso bloqueado: token ausente", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    });

    return res.status(401).json({
      error: "Token ausente.",
      requestId: req.requestId,
    });
  }

  if (!token) {
    logger.warn("TOKEN_MALFORMED", "Acesso bloqueado: formato do token inválido", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    });

    return res.status(401).json({
      error: "Token inválido ou expirado.",
      requestId: req.requestId,
    });
  }

  try {
    if (!process.env.JWT_SECRET) {
      logger.error("JWT_SECRET_MISSING", "JWT_SECRET não configurado no ambiente", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      });

      return res.status(500).json({
        error: "Erro interno do servidor.",
        requestId: req.requestId,
      });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = payload;

    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      logger.warn("TOKEN_EXPIRED", "Acesso bloqueado: token expirado", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      });

      return res.status(401).json({
        error: "Token inválido ou expirado.",
        requestId: req.requestId,
      });
    }

    logger.warn("TOKEN_INVALID", "Acesso bloqueado: token inválido", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      errorName: err.name,
    });

    return res.status(401).json({
      error: "Token inválido ou expirado.",
      requestId: req.requestId,
    });
  }
}

async function loadUser(req, res, next) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      logger.warn("TOKEN_WITHOUT_USER_ID", "Acesso bloqueado: token sem id de usuário", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
      });

      return res.status(401).json({
        error: "Token inválido ou expirado.",
        requestId: req.requestId,
      });
    }

    const { rows } = await pool.query(
      `SELECT
         id,
         name,
         email,
         role,
         company_id,
         is_active
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      logger.warn("AUTH_USER_NOT_FOUND", "Acesso bloqueado: usuário do token não encontrado", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        tokenUserId: userId,
      });

      return res.status(401).json({
        error: "Usuário não encontrado.",
        requestId: req.requestId,
      });
    }

    const dbUser = rows[0];

    if (!dbUser.is_active) {
      logger.warn("AUTH_USER_INACTIVE", "Acesso bloqueado: usuário inativo", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userId: dbUser.id,
        companyId: dbUser.company_id,
        role: dbUser.role,
        email: maskEmail(dbUser.email),
      });

      return res.status(403).json({
        error: "Usuário inativo.",
        requestId: req.requestId,
      });
    }

    if (!dbUser.company_id) {
      logger.warn("AUTH_USER_WITHOUT_COMPANY", "Acesso bloqueado: usuário sem empresa vinculada", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userId: dbUser.id,
        role: dbUser.role,
        email: maskEmail(dbUser.email),
      });

      return res.status(403).json({
        error: "Usuário sem empresa vinculada.",
        requestId: req.requestId,
      });
    }

    if (!ALLOWED_ROLES.includes(dbUser.role)) {
      logger.warn("AUTH_USER_INVALID_ROLE", "Acesso bloqueado: perfil de usuário inválido", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userId: dbUser.id,
        companyId: dbUser.company_id,
        role: dbUser.role,
        email: maskEmail(dbUser.email),
      });

      return res.status(403).json({
        error: "Perfil de usuário inválido.",
        requestId: req.requestId,
      });
    }

    req.user = dbUser;

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authRequired, loadUser };