const crypto = require("crypto");
const { logger } = require("../utils/logger");

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (forwardedFor) {
    return String(forwardedFor).split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || undefined;
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();

  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();

  res.setHeader("X-Request-Id", req.requestId);

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;

    const level = res.statusCode >= 500
      ? "error"
      : res.statusCode >= 400
        ? "warn"
        : "info";

    const event = res.statusCode >= 500
      ? "HTTP_SERVER_ERROR"
      : res.statusCode >= 400
        ? "HTTP_CLIENT_ERROR"
        : "HTTP_REQUEST";

    logger[level](event, "Requisição finalizada", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: getClientIp(req),
      userId: req.user?.id,
      companyId: req.user?.company_id,
      role: req.user?.role,
    });
  });

  return next();
}

module.exports = requestLogger;