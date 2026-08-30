const MAX_METADATA_BYTES = 8 * 1024;
const MAX_METADATA_DEPTH = 6;

const AUDIT_ACTIONS = Object.freeze({
  OS_DELETED: "OS_DELETED",
  OS_REOPENED: "OS_REOPENED",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  ACCOUNT_ACTIVATED: "ACCOUNT_ACTIVATED",
  CLIENT_ARCHIVED: "CLIENT_ARCHIVED",
  CLIENT_REACTIVATED: "CLIENT_REACTIVATED",
});

const AUDIT_ENTITY_TYPES = Object.freeze({
  ORDEM_SERVICO: "ordem_servico",
  USER: "user",
  CLIENTE: "cliente",
});

const BLOCKED_METADATA_KEYS = new Set([
  "password",
  "senha",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "confirmpassword",
  "token",
  "tokenhash",
  "resettoken",
  "invitetoken",
  "jwt",
  "authorization",
  "secret",
  "jwtsecret",
  "databaseurl",
]);

class AuditLogError extends Error {
  constructor(code, message, details = {}) {
    super(message);

    this.name = "AuditLogError";
    this.code = code;
    this.details = details;
  }
}

function assertQueryClient(db) {
  if (
    !db ||
    typeof db.query !== "function"
  ) {
    throw new TypeError(
      "Um client PostgreSQL válido é obrigatório."
    );
  }
}

function normalizeKey(key) {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeRequiredPositiveInteger(
  value,
  name
) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new AuditLogError(
      "INVALID_AUDIT_INTEGER",
      `${name} deve ser um inteiro positivo.`,
      {
        field: name,
      }
    );
  }

  return parsed;
}

function normalizeOptionalPositiveInteger(
  value,
  name
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return normalizeRequiredPositiveInteger(
    value,
    name
  );
}

function normalizeRequiredText(
  value,
  name,
  maxLength,
  pattern = null
) {
  const normalized =
    String(value || "").trim();

  if (!normalized) {
    throw new AuditLogError(
      "INVALID_AUDIT_TEXT",
      `${name} é obrigatório.`,
      {
        field: name,
      }
    );
  }

  if (normalized.length > maxLength) {
    throw new AuditLogError(
      "AUDIT_TEXT_TOO_LONG",
      `${name} excede o tamanho permitido.`,
      {
        field: name,
        maxLength,
      }
    );
  }

  if (
    pattern &&
    !pattern.test(normalized)
  ) {
    throw new AuditLogError(
      "INVALID_AUDIT_TEXT_FORMAT",
      `${name} possui formato inválido.`,
      {
        field: name,
      }
    );
  }

  return normalized;
}

function normalizeOptionalText(
  value,
  name,
  maxLength
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new AuditLogError(
      "AUDIT_TEXT_TOO_LONG",
      `${name} excede o tamanho permitido.`,
      {
        field: name,
        maxLength,
      }
    );
  }

  return normalized;
}

function normalizeMetadataValue(
  value,
  depth,
  seen
) {
  if (depth > MAX_METADATA_DEPTH) {
    throw new AuditLogError(
      "AUDIT_METADATA_TOO_DEEP",
      "Metadata de auditoria excede a profundidade permitida."
    );
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new AuditLogError(
        "AUDIT_METADATA_CIRCULAR",
        "Metadata de auditoria não pode conter referências circulares."
      );
    }

    seen.add(value);

    const normalized = value.map(
      (item) =>
        normalizeMetadataValue(
          item,
          depth + 1,
          seen
        )
    );

    seen.delete(value);

    return normalized;
  }

  if (
    typeof value === "object"
  ) {
    if (seen.has(value)) {
      throw new AuditLogError(
        "AUDIT_METADATA_CIRCULAR",
        "Metadata de auditoria não pode conter referências circulares."
      );
    }

    const prototype =
      Object.getPrototypeOf(value);

    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new AuditLogError(
        "INVALID_AUDIT_METADATA",
        "Metadata de auditoria deve conter somente dados JSON."
      );
    }

    seen.add(value);

    const output = {};

    for (
      const [key, nestedValue]
      of Object.entries(value)
    ) {
      if (
        BLOCKED_METADATA_KEYS.has(
          normalizeKey(key)
        )
      ) {
        throw new AuditLogError(
          "SENSITIVE_AUDIT_METADATA_KEY",
          "Metadata de auditoria contém uma chave sensível proibida.",
          {
            key,
          }
        );
      }

      output[key] =
        normalizeMetadataValue(
          nestedValue,
          depth + 1,
          seen
        );
    }

    seen.delete(value);

    return output;
  }

  throw new AuditLogError(
    "INVALID_AUDIT_METADATA",
    "Metadata de auditoria deve conter somente dados JSON."
  );
}

function normalizeAuditMetadata(
  metadata = {}
) {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    throw new AuditLogError(
      "INVALID_AUDIT_METADATA",
      "Metadata de auditoria deve ser um objeto JSON."
    );
  }

  const normalized =
    normalizeMetadataValue(
      metadata,
      0,
      new WeakSet()
    );

  const serialized =
    JSON.stringify(normalized);

  const sizeBytes =
    Buffer.byteLength(
      serialized,
      "utf8"
    );

  if (sizeBytes > MAX_METADATA_BYTES) {
    throw new AuditLogError(
      "AUDIT_METADATA_TOO_LARGE",
      "Metadata de auditoria excede o tamanho permitido.",
      {
        maxBytes:
          MAX_METADATA_BYTES,
        sizeBytes,
      }
    );
  }

  return {
    normalized,
    serialized,
    sizeBytes,
  };
}

async function insertAuditLog(
  db,
  input = {}
) {
  assertQueryClient(db);

  const companyId =
    normalizeRequiredPositiveInteger(
      input.companyId,
      "companyId"
    );

  const actorUserId =
    normalizeOptionalPositiveInteger(
      input.actorUserId,
      "actorUserId"
    );

  const actorRole =
    normalizeOptionalText(
      input.actorRole,
      "actorRole",
      40
    );

  const action =
    normalizeRequiredText(
      input.action,
      "action",
      80,
      /^[A-Z0-9_]+$/
    );

  const entityType =
    normalizeRequiredText(
      input.entityType,
      "entityType",
      80,
      /^[a-z0-9_]+$/
    );

  const entityId =
    normalizeOptionalPositiveInteger(
      input.entityId,
      "entityId"
    );

  const requestId =
    normalizeOptionalText(
      input.requestId,
      "requestId",
      120
    );

  const ip =
    normalizeOptionalText(
      input.ip,
      "ip",
      128
    );

  const metadata =
    normalizeAuditMetadata(
      input.metadata || {}
    );

  const result = await db.query(
    `INSERT INTO audit_logs
     (
       company_id,
       actor_user_id,
       actor_role,
       action,
       entity_type,
       entity_id,
       request_id,
       ip,
       metadata
     )
     VALUES
     ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING
       id,
       company_id,
       actor_user_id,
       actor_role,
       action,
       entity_type,
       entity_id,
       request_id,
       ip,
       metadata,
       created_at`,
    [
      companyId,
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId,
      requestId,
      ip,
      metadata.serialized,
    ]
  );

  const row =
    result &&
    result.rows &&
    result.rows[0]
      ? result.rows[0]
      : null;

  if (!row) {
    throw new AuditLogError(
      "AUDIT_LOG_NOT_RETURNED",
      "O PostgreSQL não retornou o registro de auditoria criado."
    );
  }

  return row;
}

module.exports = {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AuditLogError,
  BLOCKED_METADATA_KEYS,
  MAX_METADATA_BYTES,
  insertAuditLog,
  normalizeAuditMetadata,
};
