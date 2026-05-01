const { logger } = require("../utils/logger");

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      logger.warn("AUTH_REQUIRED", "Acesso bloqueado: usuário não autenticado", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        allowedRoles: allowed,
      });

      return res.status(401).json({
        error: "Não autenticado.",
        requestId: req.requestId,
      });
    }

    if (!allowed.includes(req.user.role)) {
      logger.warn("ACCESS_DENIED", "Acesso negado por perfil insuficiente", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userId: req.user.id,
        companyId: req.user.company_id,
        role: req.user.role,
        allowedRoles: allowed,
      });

      return res.status(403).json({
        error: "Acesso negado.",
        requestId: req.requestId,
      });
    }

    return next();
  };
}

module.exports = { requireRole };