const {
  rateLimit,
  ipKeyGenerator,
} = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error:
      "Muitas requisições. Tente novamente em alguns minutos.",
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error:
      "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
  },
});

function sensitiveActionKeyGenerator(req) {
  const userId = Number(req.user?.id);
  const companyId = Number(req.user?.company_id);

  if (
    Number.isInteger(userId) &&
    userId > 0 &&
    Number.isInteger(companyId) &&
    companyId > 0
  ) {
    return `company:${companyId}:user:${userId}`;
  }

  const ip =
    typeof req.ip === "string" && req.ip
      ? req.ip
      : "0.0.0.0";

  return `ip:${ipKeyGenerator(ip)}`;
}

const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: sensitiveActionKeyGenerator,
  message: {
    error:
      "Muitas ações sensíveis em pouco tempo. Tente novamente em alguns minutos.",
  },
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,

  keyGenerator(req) {
    const userId = Number(req.user?.id);

    if (Number.isInteger(userId) && userId > 0) {
      return `user:${userId}`;
    }

    const ip =
      typeof req.ip === "string" && req.ip
        ? req.ip
        : "0.0.0.0";

    return `ip:${ipKeyGenerator(ip)}`;
  },

  message: {
    error:
      "Muitas tentativas de alteração de senha. Aguarde alguns minutos.",
  },
});

module.exports = {
  apiLimiter,
  loginLimiter,
  sensitiveActionLimiter,
  passwordChangeLimiter,
  sensitiveActionKeyGenerator,
};
