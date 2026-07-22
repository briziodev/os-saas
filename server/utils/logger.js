const SERVICE_NAME = process.env.SERVICE_NAME || "os-saas-api";
const NODE_ENV = process.env.NODE_ENV || "development";

const MAX_SANITIZE_DEPTH = 6;

const BLOCKED_KEYS = new Set([
  "password",
  "senha",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "confirmpassword",
  "token",
  "tokenhash",
  "resettoken",
  "jwt",
  "authorization",
  "invitetoken",
  "secret",
  "jwtsecret",
  "databaseurl",
]);

const SENSITIVE_URL_PARAM_KEYS = new Set([
  "token",
  "invitetoken",
  "resettoken",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "jwt",
  "otp",
  "verificationcode",
  "password",
  "senha",
]);

const SENSITIVE_PATH_PATTERNS = [
  /(\/auth\/invite\/)[^/?#\s]+/gi,
  /(\/auth\/(?:activate|reset-password|password-reset|verify-email)\/)[^/?#\s]+/gi,
];

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

function normalizeKey(key) {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeUrlParameterKey(key) {
  let decodedKey = String(key);

  try {
    decodedKey = decodeURIComponent(decodedKey);
  } catch {
    // Mantém o valor original quando houver encoding inválido.
  }

  return normalizeKey(decodedKey);
}

function redactSensitiveUrlParameters(text) {
  return text.replace(
    /([?&#])([^=&#\s]+)=([^&#\s]*)/g,
    (fullMatch, separator, rawKey) => {
      const normalizedKey =
        normalizeUrlParameterKey(rawKey);

      if (
        !SENSITIVE_URL_PARAM_KEYS.has(
          normalizedKey
        )
      ) {
        return fullMatch;
      }

      return `${separator}${rawKey}=[REDACTED]`;
    }
  );
}

function sanitizeLogString(
  value,
  maxLength = 500
) {
  if (
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  let text = String(value);

  for (
    const pattern of SENSITIVE_PATH_PATTERNS
  ) {
    text = text.replace(
      pattern,
      "$1[REDACTED]"
    );
  }

  text = redactSensitiveUrlParameters(text);

  return safeString(text, maxLength);
}

function sanitizeValue(value, depth, seen) {
  if (value === undefined || value === null) {
    return value;
  }

  if (depth > MAX_SANITIZE_DEPTH) {
    return "[MAX_DEPTH]";
  }

  if (value instanceof Error) {
    return {
      name: safeString(value.name),
      message: safeString(value.message),
      stack:
        NODE_ENV === "production"
          ? undefined
          : safeString(value.stack, 2000),
    };
  }

  if (typeof value === "string") {
    return sanitizeLogString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}]`;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }

    seen.add(value);

    const output = value.map((item) =>
      sanitizeValue(item, depth + 1, seen)
    );

    seen.delete(value);

    return output;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[CIRCULAR]";
    }

    seen.add(value);

    const output = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (BLOCKED_KEYS.has(normalizeKey(key))) {
        output[key] = "[REDACTED]";
        continue;
      }

      output[key] = sanitizeValue(
        nestedValue,
        depth + 1,
        seen
      );
    }

    seen.delete(value);

    return output;
  }

  return safeString(value);
}

function sanitizeMeta(meta = {}) {
  const sanitized = sanitizeValue(
    meta,
    0,
    new WeakSet()
  );

  if (
    sanitized &&
    typeof sanitized === "object" &&
    !Array.isArray(sanitized)
  ) {
    return sanitized;
  }

  return {};
}

function writeLog(level, event, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    env: NODE_ENV,
    level,
    event: sanitizeLogString(event, 120),
    message: sanitizeLogString(message, 500),
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
  sanitizeLogString,
};