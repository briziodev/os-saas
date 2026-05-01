const { logger } = require("../utils/logger");

function getStatusCode(err) {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return 400;
  }

  if (err.message === "Origem não permitida pelo CORS.") {
    return 403;
  }

  if (Number.isInteger(err.statusCode)) {
    return err.statusCode;
  }

  if (Number.isInteger(err.status)) {
    return err.status;
  }

  return 500;
}

function getPublicMessage(err, statusCode) {
  if (statusCode === 400 && err instanceof SyntaxError && "body" in err) {
    return "JSON inválido.";
  }

  if (statusCode === 403 && err.message === "Origem não permitida pelo CORS.") {
    return "Origem não permitida pelo CORS.";
  }

  if (statusCode >= 500) {
    return "Erro interno do servidor.";
  }

  return err.publicMessage || err.message || "Erro na requisição.";
}

function getErrorEvent(statusCode) {
  if (statusCode >= 500) {
    return "API_SERVER_ERROR";
  }

  if (statusCode === 400) {
    return "API_BAD_REQUEST";
  }

  if (statusCode === 401) {
    return "API_UNAUTHORIZED";
  }

  if (statusCode === 403) {
    return "API_FORBIDDEN";
  }

  if (statusCode === 404) {
    return "API_NOT_FOUND";
  }

  return "API_CLIENT_ERROR";
}

function errorHandler(err, req, res, next) {
  const statusCode = getStatusCode(err);
  const event = getErrorEvent(statusCode);
  const level = statusCode >= 500 ? "error" : "warn";

  logger[level](event, "Erro capturado pelo handler global", {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    userId: req.user?.id,
    companyId: req.user?.company_id,
    role: req.user?.role,
    errorName: err.name,
    errorMessage: err.message,
    errorStack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  });

  return res.status(statusCode).json({
    error: getPublicMessage(err, statusCode),
    requestId: req.requestId,
  });
}

module.exports = errorHandler;