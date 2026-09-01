const SCHEMA_CONTRACT_ID =
  "20260830_os_safe_discard";

const REQUIRED_TABLE_COLUMNS = Object.freeze({
  companies: [
    "id",
    "name",
  ],

  users: [
    "id",
    "company_id",
    "email",
    "password_hash",
    "role",
    "is_active",
    "session_version",
    "password_changed_at",
  ],

  clientes: [
    "id",
    "company_id",
    "user_id",
    "archived_at",
    "archived_by",
    "archive_reason",
  ],

  ordens_servico: [
    "id",
    "company_id",
    "cliente_id",
    "user_id",
    "status",
    "valor_total",
    "closed_at",
    "discard_locked_at",
  ],

  os_pecas: [
    "id",
    "company_id",
    "os_id",
  ],

  os_events: [
    "id",
    "company_id",
    "os_id",
    "event_type",
    "created_at",
  ],

  password_reset_tokens: [
    "id",
    "user_id",
    "token_hash",
    "expires_at",
    "used_at",
    "revoked_at",
    "created_at",
  ],

  audit_logs: [
    "id",
    "company_id",
    "actor_user_id",
    "actor_role",
    "action",
    "entity_type",
    "entity_id",
    "request_id",
    "ip",
    "metadata",
    "created_at",
  ],
});

const REQUIRED_CONSTRAINTS = Object.freeze([
  "users_session_version_positive",
  "password_reset_tokens_pkey",
  "password_reset_tokens_user_fk",
  "password_reset_tokens_token_hash_unique",
  "password_reset_tokens_hash_length",
  "password_reset_tokens_expiry_after_creation",
  "password_reset_tokens_terminal_state",
  "audit_logs_pkey",
  "audit_logs_company_id_positive",
  "audit_logs_actor_user_id_positive",
  "audit_logs_entity_id_positive",
  "audit_logs_action_nonempty",
  "audit_logs_entity_type_nonempty",
  "audit_logs_metadata_object",
  "clientes_archived_by_positive",
  "clientes_archival_state_consistent",
  "clientes_archived_by_fk",
  "ordens_servico_discard_lock_status_consistent",
]);

const REQUIRED_INDEXES = Object.freeze([
  "password_reset_tokens_expires_at_idx",
  "password_reset_tokens_one_pending_per_user_idx",
  "password_reset_tokens_token_hash_unique",
  "password_reset_tokens_user_created_idx",
  "idx_audit_logs_company_created",
  "idx_audit_logs_company_action_created",
  "idx_audit_logs_entity_lookup",
  "idx_audit_logs_created_at",
  "idx_clientes_company_active",
  "idx_clientes_company_archived",
]);

const SCHEMA_SNAPSHOT_SQL = `
  SELECT json_build_object(
    'columns',
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'table_name',
                table_name,
              'column_name',
                column_name
            )
            ORDER BY
              table_name,
              ordinal_position
          )
          FROM information_schema.columns
          WHERE table_schema = 'public'
        ),
        '[]'::json
      ),

    'constraints',
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'name',
                conname,
              'validated',
                convalidated
            )
            ORDER BY conname
          )
          FROM pg_constraint
          WHERE connamespace =
            'public'::regnamespace
        ),
        '[]'::json
      ),

    'indexes',
      COALESCE(
        (
          SELECT json_agg(
            indexname
            ORDER BY indexname
          )
          FROM pg_indexes
          WHERE schemaname = 'public'
        ),
        '[]'::json
      )
  ) AS schema_snapshot
`;

function getArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function evaluateSchemaSnapshot(snapshot = {}) {
  const columns = getArray(snapshot.columns);
  const constraints = getArray(
    snapshot.constraints
  );
  const indexes = getArray(snapshot.indexes);

  const availableTables = new Set();
  const availableColumns = new Set();

  for (const item of columns) {
    const tableName = String(
      item?.table_name || ""
    ).trim();

    const columnName = String(
      item?.column_name || ""
    ).trim();

    if (!tableName || !columnName) {
      continue;
    }

    availableTables.add(tableName);
    availableColumns.add(
      `${tableName}.${columnName}`
    );
  }

  const missingTables = [];
  const missingColumns = [];

  for (
    const [tableName, requiredColumns]
    of Object.entries(
      REQUIRED_TABLE_COLUMNS
    )
  ) {
    if (!availableTables.has(tableName)) {
      missingTables.push(tableName);
      continue;
    }

    for (const columnName of requiredColumns) {
      const qualifiedName =
        `${tableName}.${columnName}`;

      if (
        !availableColumns.has(qualifiedName)
      ) {
        missingColumns.push(qualifiedName);
      }
    }
  }

  const constraintMap = new Map();

  for (const item of constraints) {
    const name = String(
      item?.name || ""
    ).trim();

    if (!name) {
      continue;
    }

    constraintMap.set(
      name,
      item.validated !== false
    );
  }

  const missingConstraints = [];
  const invalidConstraints = [];

  for (
    const constraintName
    of REQUIRED_CONSTRAINTS
  ) {
    if (!constraintMap.has(constraintName)) {
      missingConstraints.push(
        constraintName
      );
      continue;
    }

    if (
      constraintMap.get(constraintName)
      !== true
    ) {
      invalidConstraints.push(
        constraintName
      );
    }
  }

  const availableIndexes = new Set(
    indexes
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }

        return String(
          item?.indexname || ""
        ).trim();
      })
      .filter(Boolean)
  );

  const missingIndexes =
    REQUIRED_INDEXES.filter(
      (indexName) =>
        !availableIndexes.has(indexName)
    );

  const compatible =
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    missingConstraints.length === 0 &&
    invalidConstraints.length === 0 &&
    missingIndexes.length === 0;

  return {
    compatible,
    contractId: SCHEMA_CONTRACT_ID,
    missingTables,
    missingColumns,
    missingConstraints,
    invalidConstraints,
    missingIndexes,
  };
}

async function checkSchemaReadiness(pool) {
  if (
    !pool ||
    typeof pool.query !== "function"
  ) {
    throw new TypeError(
      "Pool PostgreSQL inválido."
    );
  }

  const result = await pool.query(
    SCHEMA_SNAPSHOT_SQL
  );

  const snapshot =
    result.rows[0]?.schema_snapshot || {};

  return evaluateSchemaSnapshot(snapshot);
}

function createSchemaReadinessChecker(
  pool,
  options = {}
) {
  if (
    !pool ||
    typeof pool.query !== "function"
  ) {
    throw new TypeError(
      "Pool PostgreSQL inválido."
    );
  }

  const configuredTtlMs =
    Number(options.ttlMs);

  const ttlMs =
    Number.isFinite(configuredTtlMs) &&
    configuredTtlMs >= 0
      ? configuredTtlMs
      : 30_000;

  const now =
    typeof options.now === "function"
      ? options.now
      : Date.now;

  let cachedResult = null;
  let cacheExpiresAt = 0;
  let inFlightCheck = null;

  async function check() {
    const currentTime = now();

    if (
      cachedResult &&
      currentTime < cacheExpiresAt
    ) {
      return cachedResult;
    }

    if (inFlightCheck) {
      return inFlightCheck;
    }

    inFlightCheck =
      checkSchemaReadiness(pool)
        .then((result) => {
          cachedResult = result;
          cacheExpiresAt =
            now() + ttlMs;

          return result;
        })
        .finally(() => {
          inFlightCheck = null;
        });

    return inFlightCheck;
  }

  function clear() {
    cachedResult = null;
    cacheExpiresAt = 0;
  }

  return {
    check,
    clear,
    ttlMs,
  };
}

module.exports = {
  SCHEMA_CONTRACT_ID,
  REQUIRED_TABLE_COLUMNS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  evaluateSchemaSnapshot,
  checkSchemaReadiness,
  createSchemaReadinessChecker,
};