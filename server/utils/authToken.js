const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!secret) {
    const error = new Error("JWT_SECRET não configurado.");
    error.code = "JWT_SECRET_MISSING";
    throw error;
  }

  return secret;
}

function signAuthToken(user) {
  const sessionVersion = Number(user?.session_version);

  if (!Number.isInteger(sessionVersion) || sessionVersion < 1) {
    const error = new Error(
      "Não foi possível emitir token para uma sessão sem versão válida."
    );
    error.code = "INVALID_SESSION_VERSION";
    throw error;
  }

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      company_id: user.company_id,
      role: user.role,
      session_version: sessionVersion,
    },
    getJwtSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
}

module.exports = {
  signAuthToken,
};
