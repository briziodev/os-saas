const SCHEMA_MIGRATIONS_TABLE =
  "public.schema_migrations";

/*
 * Chaves estáveis para o advisory lock do runner.
 * Não devem ser alteradas após a entrada em produção.
 */
const MIGRATION_LOCK_KEYS =
  Object.freeze([
    1869837167,
    1836282995,
  ]);

const CREATE_METADATA_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS
    public.schema_migrations (
      id text PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum char(64) NOT NULL,
      baseline boolean NOT NULL DEFAULT false,
      execution_ms integer NOT NULL DEFAULT 0,
      applied_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT
        schema_migrations_checksum_format
        CHECK (
          checksum ~ '^[a-f0-9]{64}$'
        ),

      CONSTRAINT
        schema_migrations_execution_ms_nonnegative
        CHECK (
          execution_ms >= 0
        )
    )
`;

class MigrationStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);

    this.name = "MigrationStoreError";
    this.code = code;
    this.details = details;
  }
}

function assertQueryClient(client) {
  if (
    !client ||
    typeof client.query !== "function"
  ) {
    throw new TypeError(
      "Um client PostgreSQL válido é obrigatório."
    );
  }
}

function normalizeMigrationRecord(input = {}) {
  const id = String(
    input.id || ""
  ).trim();

  const filename = String(
    input.filename || ""
  ).trim();

  const checksum = String(
    input.checksum || ""
  )
    .trim()
    .toLowerCase();

  const baseline =
    input.baseline ?? false;

  const executionMs =
    input.executionMs ?? 0;

  if (!id) {
    throw new MigrationStoreError(
      "INVALID_MIGRATION_ID",
      "O ID da migration é obrigatório."
    );
  }

  if (!filename) {
    throw new MigrationStoreError(
      "INVALID_MIGRATION_FILENAME",
      "O nome do arquivo é obrigatório."
    );
  }

  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new MigrationStoreError(
      "INVALID_MIGRATION_CHECKSUM",
      "O checksum deve possuir 64 caracteres hexadecimais.",
      {
        id,
        filename,
      }
    );
  }

  if (
    typeof baseline !== "boolean"
  ) {
    throw new MigrationStoreError(
      "INVALID_MIGRATION_BASELINE",
      "baseline deve ser booleano.",
      {
        id,
        baseline,
      }
    );
  }

  if (
    !Number.isInteger(executionMs) ||
    executionMs < 0
  ) {
    throw new MigrationStoreError(
      "INVALID_MIGRATION_EXECUTION_TIME",
      "executionMs deve ser um inteiro não negativo.",
      {
        id,
        executionMs,
      }
    );
  }

  return {
    id,
    filename,
    checksum,
    baseline,
    executionMs,
  };
}

async function metadataTableExists(client) {
  assertQueryClient(client);

  const result = await client.query(
    `
      SELECT
        to_regclass($1) IS NOT NULL
          AS exists
    `,
    [
      SCHEMA_MIGRATIONS_TABLE,
    ]
  );

  return Boolean(
    result &&
    result.rows &&
    result.rows[0] &&
    result.rows[0].exists
  );
}

async function ensureMetadataTable(client) {
  assertQueryClient(client);

  await client.query(
    CREATE_METADATA_TABLE_SQL
  );
}

async function readMigrationState(client) {
  assertQueryClient(client);

  const tableExists =
    await metadataTableExists(client);

  if (!tableExists) {
    return {
      metadataTableExists: false,
      appliedRows: [],
    };
  }

  const result = await client.query(`
    SELECT
      id,
      filename,
      checksum,
      baseline,
      execution_ms,
      applied_at
    FROM
      public.schema_migrations
    ORDER BY
      id ASC
  `);

  return {
    metadataTableExists: true,
    appliedRows:
      Array.isArray(result.rows)
        ? result.rows
        : [],
  };
}

async function recordAppliedMigration(
  client,
  input
) {
  assertQueryClient(client);

  const migration =
    normalizeMigrationRecord(input);

  const result = await client.query(
    `
      INSERT INTO public.schema_migrations (
        id,
        filename,
        checksum,
        baseline,
        execution_ms
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5
      )
      RETURNING
        id,
        filename,
        checksum,
        baseline,
        execution_ms,
        applied_at
    `,
    [
      migration.id,
      migration.filename,
      migration.checksum,
      migration.baseline,
      migration.executionMs,
    ]
  );

  const row =
    result &&
    result.rows &&
    result.rows[0]
      ? result.rows[0]
      : null;

  if (!row) {
    throw new MigrationStoreError(
      "MIGRATION_RECORD_NOT_RETURNED",
      "O PostgreSQL não retornou o registro da migration aplicada.",
      {
        id: migration.id,
        filename: migration.filename,
      }
    );
  }

  return row;
}

async function acquireMigrationLock(
  client,
  options = {}
) {
  assertQueryClient(client);

  const wait =
    Boolean(options.wait);

  if (wait) {
    await client.query(
      `
        SELECT pg_advisory_lock(
          $1::integer,
          $2::integer
        )
      `,
      MIGRATION_LOCK_KEYS
    );

    return true;
  }

  const result = await client.query(
    `
      SELECT pg_try_advisory_lock(
        $1::integer,
        $2::integer
      ) AS acquired
    `,
    MIGRATION_LOCK_KEYS
  );

  const acquired = Boolean(
    result &&
    result.rows &&
    result.rows[0] &&
    result.rows[0].acquired
  );

  if (!acquired) {
    throw new MigrationStoreError(
      "MIGRATION_LOCK_UNAVAILABLE",
      "Outro processo já está executando migrations."
    );
  }

  return true;
}

async function releaseMigrationLock(client) {
  assertQueryClient(client);

  const result = await client.query(
    `
      SELECT pg_advisory_unlock(
        $1::integer,
        $2::integer
      ) AS released
    `,
    MIGRATION_LOCK_KEYS
  );

  return Boolean(
    result &&
    result.rows &&
    result.rows[0] &&
    result.rows[0].released
  );
}

module.exports = {
  CREATE_METADATA_TABLE_SQL,
  MIGRATION_LOCK_KEYS,
  SCHEMA_MIGRATIONS_TABLE,
  MigrationStoreError,
  acquireMigrationLock,
  ensureMetadataTable,
  metadataTableExists,
  normalizeMigrationRecord,
  readMigrationState,
  recordAppliedMigration,
  releaseMigrationLock,
};
