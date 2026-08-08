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

const METADATA_COLUMNS_SQL = `
  SELECT
    a.attname AS column_name,
    pg_catalog.format_type(
      a.atttypid,
      a.atttypmod
    ) AS data_type,
    a.attnotnull AS not_null,
    pg_catalog.pg_get_expr(
      d.adbin,
      d.adrelid
    ) AS column_default,
    c.relkind AS relation_kind
  FROM
    pg_catalog.pg_attribute AS a
  INNER JOIN
    pg_catalog.pg_class AS c
      ON c.oid = a.attrelid
  INNER JOIN
    pg_catalog.pg_namespace AS n
      ON n.oid = c.relnamespace
  LEFT JOIN
    pg_catalog.pg_attrdef AS d
      ON d.adrelid = a.attrelid
      AND d.adnum = a.attnum
  WHERE
    n.nspname = $1
    AND c.relname = $2
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY
    a.attnum ASC
`;

const METADATA_CONSTRAINTS_SQL = `
  SELECT
    constraint_row.conname
      AS constraint_name,
    constraint_row.contype
      AS constraint_type,
    constraint_row.condeferrable
      AS deferrable,
    constraint_row.condeferred
      AS deferred,
    constraint_row.conenforced
      AS enforced,
    constraint_row.convalidated
      AS validated,
    ARRAY(
      SELECT
        attribute.attname
      FROM
        unnest(
          constraint_row.conkey
        ) WITH ORDINALITY
          AS key_column(
            attnum,
            position
          )
      INNER JOIN
        pg_catalog.pg_attribute
          AS attribute
        ON
          attribute.attrelid =
            constraint_row.conrelid
          AND attribute.attnum =
            key_column.attnum
      ORDER BY
        key_column.position
    ) AS columns,
    pg_catalog.pg_get_constraintdef(
      constraint_row.oid,
      true
    ) AS definition
  FROM
    pg_catalog.pg_constraint
      AS constraint_row
  INNER JOIN
    pg_catalog.pg_class AS c
      ON c.oid =
        constraint_row.conrelid
  INNER JOIN
    pg_catalog.pg_namespace AS n
      ON n.oid =
        c.relnamespace
  WHERE
    n.nspname = $1
    AND c.relname = $2
    AND constraint_row.contype
      IN ('p', 'u', 'c')
  ORDER BY
    constraint_row.conname ASC
`;

const EXPECTED_METADATA_COLUMNS =
  Object.freeze([
    {
      name: "id",
      dataType: "text",
      notNull: true,
      defaultExpression: null,
    },
    {
      name: "filename",
      dataType: "text",
      notNull: true,
      defaultExpression: null,
    },
    {
      name: "checksum",
      dataType: "character(64)",
      notNull: true,
      defaultExpression: null,
    },
    {
      name: "baseline",
      dataType: "boolean",
      notNull: true,
      defaultExpression: "false",
    },
    {
      name: "execution_ms",
      dataType: "integer",
      notNull: true,
      defaultExpression: "0",
    },
    {
      name: "applied_at",
      dataType:
        "timestamp with time zone",
      notNull: true,
      defaultExpression: "now",
    },
  ]);
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

function normalizeSqlFragment(value) {
  const input =
    String(value || "").trim();

  let normalized = "";
  let insideString = false;

  for (
    let index = 0;
    index < input.length;
    index += 1
  ) {
    const character =
      input[index];

    if (character === "'") {
      normalized += character;

      if (
        insideString &&
        input[index + 1] === "'"
      ) {
        normalized += "'";
        index += 1;

        continue;
      }

      insideString =
        !insideString;

      continue;
    }

    if (insideString) {
      normalized += character;

      continue;
    }

    const castMatch =
      input
        .slice(index)
        .match(
          /^::(?:pg_catalog\.)?(?:text|boolean|integer|bpchar)\b/i
        );

    if (castMatch) {
      index +=
        castMatch[0].length - 1;

      continue;
    }

    if (
      /\s/.test(character) ||
      character === "(" ||
      character === ")"
    ) {
      continue;
    }

    normalized +=
      character.toLowerCase();
  }

  return normalized;
}

function defaultExpressionMatches(
  actual,
  expected
) {
  if (expected === null) {
    return (
      actual === null ||
      actual === undefined
    );
  }

  const normalized =
    normalizeSqlFragment(actual);

  if (expected === "now") {
    return (
      normalized === "now" ||
      normalized ===
        "current_timestamp"
    );
  }

  return normalized === expected;
}

function normalizeConstraintColumns(
  columns
) {
  if (!Array.isArray(columns)) {
    return [];
  }

  return columns.map((column) =>
    String(column)
  );
}

function hasKeyConstraint(
  constraints,
  type,
  expectedColumns
) {
  return constraints.some(
    (constraint) => {
      if (
        constraint.constraint_type !==
          type ||
        constraint.deferrable !==
          false ||
        constraint.deferred !==
          false
      ) {
        return false;
      }

      const columns =
        normalizeConstraintColumns(
          constraint.columns
        );

      return (
        columns.length ===
          expectedColumns.length &&
        columns.every(
          (column, index) =>
            column ===
            expectedColumns[index]
        )
      );
    }
  );
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

async function validateMetadataTableContract(
  client
) {
  assertQueryClient(client);

  const columnResult =
    await client.query(
      METADATA_COLUMNS_SQL,
      [
        "public",
        "schema_migrations",
      ]
    );

  const constraintResult =
    await client.query(
      METADATA_CONSTRAINTS_SQL,
      [
        "public",
        "schema_migrations",
      ]
    );

  const columns =
    Array.isArray(
      columnResult &&
        columnResult.rows
    )
      ? columnResult.rows
      : [];

  const constraints =
    Array.isArray(
      constraintResult &&
        constraintResult.rows
    )
      ? constraintResult.rows
      : [];

  const issues = [];

  const columnsByName =
    new Map(
      columns.map((column) => [
        column.column_name,
        column,
      ])
    );

  for (
    const expected of
    EXPECTED_METADATA_COLUMNS
  ) {
    const actual =
      columnsByName.get(
        expected.name
      );

    if (!actual) {
      issues.push(
        `MISSING_COLUMN:${expected.name}`
      );

      continue;
    }

    if (
      actual.relation_kind !== "r"
    ) {
      issues.push(
        "INVALID_RELATION_KIND"
      );
    }

    if (
      String(actual.data_type) !==
      expected.dataType
    ) {
      issues.push(
        `INVALID_COLUMN_TYPE:${expected.name}`
      );
    }

    if (
      Boolean(actual.not_null) !==
      expected.notNull
    ) {
      issues.push(
        `INVALID_NULLABILITY:${expected.name}`
      );
    }

    if (
      !defaultExpressionMatches(
        actual.column_default,
        expected.defaultExpression
      )
    ) {
      issues.push(
        `INVALID_DEFAULT:${expected.name}`
      );
    }
  }

  for (const actual of columns) {
    const isExpected =
      EXPECTED_METADATA_COLUMNS.some(
        (expected) =>
          expected.name ===
          actual.column_name
      );

    if (!isExpected) {
      issues.push(
        `UNEXPECTED_COLUMN:${actual.column_name}`
      );
    }
  }

  if (
    !hasKeyConstraint(
      constraints,
      "p",
      ["id"]
    )
  ) {
    issues.push(
      "INVALID_PRIMARY_KEY"
    );
  }

  if (
    !hasKeyConstraint(
      constraints,
      "u",
      ["filename"]
    )
  ) {
    issues.push(
      "INVALID_FILENAME_UNIQUE"
    );
  }

  const checksumConstraint =
    constraints.find(
      (constraint) =>
        constraint.constraint_name ===
          "schema_migrations_checksum_format" &&
        constraint.constraint_type ===
          "c"
    );

  if (!checksumConstraint) {
    issues.push(
      "MISSING_CHECKSUM_CONSTRAINT"
    );
  } else if (
    checksumConstraint.enforced !==
      true ||
    checksumConstraint.validated !==
      true ||
    normalizeSqlFragment(
      checksumConstraint.definition
    ) !==
      "checkchecksum~'^[a-f0-9]{64}$'"
  ) {
    issues.push(
      "INVALID_CHECKSUM_CONSTRAINT"
    );
  }

  const executionConstraint =
    constraints.find(
      (constraint) =>
        constraint.constraint_name ===
          "schema_migrations_execution_ms_nonnegative" &&
        constraint.constraint_type ===
          "c"
    );

  if (!executionConstraint) {
    issues.push(
      "MISSING_EXECUTION_MS_CONSTRAINT"
    );
  } else if (
    executionConstraint.enforced !==
      true ||
    executionConstraint.validated !==
      true ||
    normalizeSqlFragment(
      executionConstraint.definition
    ) !==
      "checkexecution_ms>=0"
  ) {
    issues.push(
      "INVALID_EXECUTION_MS_CONSTRAINT"
    );
  }

  if (constraints.length !== 4) {
    issues.push(
      "UNEXPECTED_CONSTRAINT_COUNT"
    );
  }

  if (issues.length > 0) {
    throw new MigrationStoreError(
      "INVALID_METADATA_TABLE_CONTRACT",
      "A tabela public.schema_migrations possui contrato fisico incompativel.",
      {
        issues: [
          ...new Set(issues),
        ],
      }
    );
  }

  return true;
}
async function ensureMetadataTable(client) {
  assertQueryClient(client);

  await client.query(
    CREATE_METADATA_TABLE_SQL
  );

  await validateMetadataTableContract(
    client
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

  await validateMetadataTableContract(
    client
  );

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
  validateMetadataTableContract,
};
