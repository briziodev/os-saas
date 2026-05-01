const SERVICE_NAME = process.env.SERVICE_NAME || "os-saas-api";
const NODE_ENV = process.env.NODE_ENV || "development";

function safeString(value, maxLength = 500) {
  if (value === undefined || value === null) return undefined;

  const text = String(value);

  if (text.length <= maxLength) return text;

  return `${text.slice(0, maxLength)}...`;
}

function maskEmail(email) {
  if (!email) return undefined;

  const text = String(email).trim().toLowerCase();
  const [name, domain] = text.split("@");

  if (!name || !domain) return "email_invalido";

  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
}

function maskToken(token) {
  if (!token) return undefined;

  const text = String(token);

  if (text.length <= 8) return "***";

  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sanitizeMeta(meta = {}) {
  const blockedKeys = new Set([
    "password",
    "senha",
    "password_hash",
    "token",
    "jwt",
    "authorization",
    "invite_token",
    "secret",
    "jwt_secret",
  ]);

  const output = {};

  for (const [key, value] of Object.entries(meta || {})) {
    const normalizedKey = String(key).toLowerCase();

    if (blockedKeys.has(normalizedKey)) {
      output[key] = "[REDACTED]";
      continue;
    }

    if (value instanceof Error) {
      output[key] = {
        name: value.name,
        message: safeString(value.message),
        stack: NODE_ENV === "production" ? undefined : safeString(value.stack, 2000),
      };
      continue;
    }

    if (typeof value === "string") {
      output[key] = safeString(value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function writeLog(level, event, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    env: NODE_ENV,
    level,
    event,
    message,
    ...sanitizeMeta(meta),
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }

  process.stdout.write(`${line}\n`);
}

const logger = {
  info(event, message, meta = {}) {
    writeLog("info", event, message, meta);
  },

  warn(event, message, meta = {}) {
    writeLog("warn", event, message, meta);
  },

  error(event, message, meta = {}) {
    writeLog("error", event, message, meta);
  },

  debug(event, message, meta = {}) {
    if (NODE_ENV !== "production") {
      writeLog("debug", event, message, meta);
    }
  },
};

module.exports = {
  logger,
  maskEmail,
  maskToken,
};