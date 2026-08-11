const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const CANONICAL_BASELINE_FILENAME =
  "20260802000000_baseline_current_schema.sql";

const CANONICAL_BASELINE_CHECKSUM =
  "E9CA6FFC8A7289289D4E8C80FB1A2C8BC9C54CF7B0281C8F2BD98423D363EAFE";

const CANONICAL_SCHEMA_SEMANTIC_CHECKSUM =
  "CC880BD139AC2452669A1847E9363F20F8F976B6AA49D0F10B829EA909CF03F7";

const DEFAULT_BASELINE_FILE_PATH =
  path.join(
    __dirname,
    "..",
    "migrations",
    "versions",
    CANONICAL_BASELINE_FILENAME
  );

const EMPTY_SCHEMA_SNAPSHOT_SQL = `
  SELECT
    json_build_object(
      'relations',
        COALESCE(
          (
            SELECT
              json_agg(
                json_build_object(
                  'name',
                    relation.relname,
                  'kind',
                    relation.relkind
                )
                ORDER BY
                  relation.relname,
                  relation.relkind
              )
            FROM
              pg_catalog.pg_class
                AS relation
            INNER JOIN
              pg_catalog.pg_namespace
                AS namespace
              ON namespace.oid =
                relation.relnamespace
            WHERE
              namespace.nspname =
                'public'
              AND relation.relkind
                IN (
                  'r',
                  'p',
                  'v',
                  'm',
                  'f',
                  'S'
                )
          ),
          '[]'::json
        ),

      'types',
        COALESCE(
          (
            SELECT
              json_agg(
                json_build_object(
                  'name',
                    type_row.typname,
                  'kind',
                    type_row.typtype
                )
                ORDER BY
                  type_row.typname,
                  type_row.typtype
              )
            FROM
              pg_catalog.pg_type
                AS type_row
            INNER JOIN
              pg_catalog.pg_namespace
                AS namespace
              ON namespace.oid =
                type_row.typnamespace
            WHERE
              namespace.nspname =
                'public'
              AND NOT EXISTS (
                SELECT 1
                FROM
                  pg_catalog.pg_class
                    AS relation
                WHERE
                  relation.reltype =
                    type_row.oid
              )
          ),
          '[]'::json
        ),

      'routines',
        COALESCE(
          (
            SELECT
              json_agg(
                json_build_object(
                  'name',
                    routine.proname,
                  'kind',
                    routine.prokind
                )
                ORDER BY
                  routine.proname,
                  routine.oid
              )
            FROM
              pg_catalog.pg_proc
                AS routine
            INNER JOIN
              pg_catalog.pg_namespace
                AS namespace
              ON namespace.oid =
                routine.pronamespace
            WHERE
              namespace.nspname =
                'public'
          ),
          '[]'::json
        )
    ) AS schema_snapshot
`;

class BaselineSchemaVerifierError
  extends Error {
  constructor(
    code,
    message,
    details = {}
  ) {
    super(message);

    this.name =
      "BaselineSchemaVerifierError";

    this.code = code;
    this.details = details;
  }
}

function normalizeChecksum(
  value,
  label
) {
  const checksum =
    String(value || "")
      .trim()
      .toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new BaselineSchemaVerifierError(
      "INVALID_EXPECTED_CHECKSUM",
      `${label} possui formato inválido.`
    );
  }

  return checksum;
}

function calculateSha256(value) {
  const input =
    Buffer.isBuffer(value)
      ? value
      : Buffer.from(
          String(value ?? ""),
          "utf8"
        );

  return crypto
    .createHash("sha256")
    .update(input)
    .digest("hex");
}

function normalizeLines(
  input,
  shouldSkipLine
) {
  if (typeof input !== "string") {
    throw new TypeError(
      "O dump de schema deve ser uma string."
    );
  }

  const source =
    input
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  const result = [];
  let previousWasBlank = false;

  for (
    const line of source.split("\n")
  ) {
    if (
      typeof shouldSkipLine ===
        "function" &&
      shouldSkipLine(line)
    ) {
      continue;
    }

    const normalizedLine =
      line.trimEnd();

    const isBlank =
      normalizedLine
        .trim()
        .length === 0;

    if (
      isBlank &&
      previousWasBlank
    ) {
      continue;
    }

    result.push(normalizedLine);
    previousWasBlank = isBlank;
  }

  return (
    `${result.join("\n").trim()}\n`
  );
}

function normalizeSchemaDump(input) {
  return normalizeLines(
    input,
    (line) =>
      /^\s*--/.test(line) ||
      /^\s*\\restrict\b/.test(line) ||
      /^\s*\\unrestrict\b/.test(line)
  );
}

function normalizeSemanticSchemaDump(
  input
) {
  const normalized =
    normalizeSchemaDump(input);

  const canonicalized =
    normalized
      .split("\n")
      .map(
        (line) =>
          /^\s*CREATE SCHEMA public;\s*$/.test(
            line
          )
            ? "CREATE SCHEMA IF NOT EXISTS public;"
            : line
      )
      .join("\n");

  return normalizeLines(
    canonicalized,
    (line) =>
      /^\s*COMMENT ON SCHEMA public IS 'standard public schema';\s*$/.test(
        line
      )
  );
}

async function verifyCanonicalBaselineFile(
  options = {}
) {
  const filePath =
    options.filePath ||
    DEFAULT_BASELINE_FILE_PATH;

  const expectedChecksum =
    normalizeChecksum(
      options.expectedChecksum ||
        CANONICAL_BASELINE_CHECKSUM,
      "O checksum esperado da baseline"
    );

  const readFile =
    options.readFile ||
    fs.readFile;

  if (
    typeof readFile !== "function"
  ) {
    throw new TypeError(
      "readFile deve ser uma função."
    );
  }

  let content;

  try {
    content =
      await readFile(filePath);
  } catch (error) {
    throw new BaselineSchemaVerifierError(
      "BASELINE_FILE_READ_FAILED",
      "Não foi possível ler a baseline canônica.",
      {
        filename:
          path.basename(filePath),
        causeCode:
          error &&
          error.code
            ? String(error.code)
            : null,
      }
    );
  }

  const actualChecksum =
    calculateSha256(content);

  if (
    actualChecksum !==
    expectedChecksum
  ) {
    throw new BaselineSchemaVerifierError(
      "BASELINE_FILE_CHECKSUM_MISMATCH",
      "A baseline canônica diverge do checksum aprovado.",
      {
        filename:
          path.basename(filePath),
        expectedChecksum,
        actualChecksum,
      }
    );
  }

  return {
    filename:
      path.basename(filePath),
    checksum:
      actualChecksum,
  };
}

function verifySchemaDumpAgainstCanonical(
  dumpSql,
  options = {}
) {
  const expectedSemanticChecksum =
    normalizeChecksum(
      options
        .expectedSemanticChecksum ||
        CANONICAL_SCHEMA_SEMANTIC_CHECKSUM,
      "O checksum semântico esperado"
    );

  const normalized =
    normalizeSemanticSchemaDump(
      dumpSql
    );

  const actualSemanticChecksum =
    calculateSha256(normalized);

  if (
    actualSemanticChecksum !==
    expectedSemanticChecksum
  ) {
    throw new BaselineSchemaVerifierError(
      "BASELINE_SCHEMA_MISMATCH",
      "O schema atual não corresponde semanticamente à baseline canônica.",
      {
        expectedSemanticChecksum,
        actualSemanticChecksum,
      }
    );
  }

  return {
    semanticChecksum:
      actualSemanticChecksum,
  };
}

function normalizeSnapshotEntries(
  value,
  label
) {
  if (!Array.isArray(value)) {
    throw new BaselineSchemaVerifierError(
      "INVALID_EMPTY_SCHEMA_SNAPSHOT",
      "O snapshot usado para validar banco vazio é inválido.",
      {
        field: label,
      }
    );
  }

  return value.map(
    (item) => ({
      name:
        String(
          item &&
          item.name
            ? item.name
            : ""
        ).trim(),
      kind:
        String(
          item &&
          item.kind
            ? item.kind
            : ""
        ).trim(),
    })
  );
}

function evaluateEmptySchemaSnapshot(
  snapshot
) {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    throw new BaselineSchemaVerifierError(
      "INVALID_EMPTY_SCHEMA_SNAPSHOT",
      "O snapshot usado para validar banco vazio é inválido."
    );
  }

  const relations =
    normalizeSnapshotEntries(
      snapshot.relations,
      "relations"
    );

  const types =
    normalizeSnapshotEntries(
      snapshot.types,
      "types"
    );

  const routines =
    normalizeSnapshotEntries(
      snapshot.routines,
      "routines"
    );

  const counts = {
    relations:
      relations.length,
    types:
      types.length,
    routines:
      routines.length,
  };

  return {
    empty:
      counts.relations === 0 &&
      counts.types === 0 &&
      counts.routines === 0,

    counts,

    objects: {
      relations,
      types,
      routines,
    },
  };
}

function assertQueryClient(client) {
  if (
    !client ||
    typeof client.query !==
      "function"
  ) {
    throw new TypeError(
      "Um client PostgreSQL válido é obrigatório."
    );
  }
}

async function verifyEmptySchema(
  client
) {
  assertQueryClient(client);

  const result =
    await client.query(
      EMPTY_SCHEMA_SNAPSHOT_SQL
    );

  const snapshot =
    result &&
    result.rows &&
    result.rows[0]
      ? result.rows[0]
          .schema_snapshot
      : null;

  const evaluation =
    evaluateEmptySchemaSnapshot(
      snapshot
    );

  if (!evaluation.empty) {
    throw new BaselineSchemaVerifierError(
      "DATABASE_NOT_EMPTY",
      "O schema public contém objetos e não pode usar o modo apply-empty.",
      {
        counts:
          evaluation.counts,
        objects:
          evaluation.objects,
      }
    );
  }

  return evaluation;
}

function createBaselineSchemaVerifier(
  options = {}
) {
  const baselineFilePath =
    options.baselineFilePath ||
    DEFAULT_BASELINE_FILE_PATH;

  const expectedBaselineChecksum =
    options.expectedBaselineChecksum ||
    CANONICAL_BASELINE_CHECKSUM;

  const expectedSemanticChecksum =
    options.expectedSemanticChecksum ||
    CANONICAL_SCHEMA_SEMANTIC_CHECKSUM;

  const readFile =
    options.readFile ||
    fs.readFile;

  const dumpSchema =
    options.dumpSchema;

  async function verifyCanonicalBaseline() {
    return verifyCanonicalBaselineFile({
      filePath:
        baselineFilePath,
      expectedChecksum:
        expectedBaselineChecksum,
      readFile,
    });
  }

  async function verifyExistingSchema() {
    const baseline =
      await verifyCanonicalBaseline();

    if (
      typeof dumpSchema !==
        "function"
    ) {
      throw new BaselineSchemaVerifierError(
        "SCHEMA_DUMP_PROVIDER_REQUIRED",
        "Um provedor de pg_dump é obrigatório para validar banco existente."
      );
    }

    let dumpSql;

    try {
      dumpSql =
        await dumpSchema();
    } catch (error) {
      throw new BaselineSchemaVerifierError(
        "SCHEMA_DUMP_FAILED",
        "Não foi possível obter o dump estrutural do banco.",
        {
          causeCode:
            error &&
            error.code
              ? String(error.code)
              : null,
        }
      );
    }

    const schema =
      verifySchemaDumpAgainstCanonical(
        dumpSql,
        {
          expectedSemanticChecksum,
        }
      );

    return {
      baseline,
      schema,
    };
  }

  async function verifyEmpty(client) {
    const baseline =
      await verifyCanonicalBaseline();

    const schema =
      await verifyEmptySchema(
        client
      );

    return {
      baseline,
      schema,
    };
  }

  return Object.freeze({
    verifyCanonicalBaseline,
    verifyExistingSchema,
    verifyEmpty,
  });
}

module.exports = {
  BASELINE_SCHEMA_VERIFIER_VERSION:
    1,
  CANONICAL_BASELINE_CHECKSUM,
  CANONICAL_BASELINE_FILENAME,
  CANONICAL_SCHEMA_SEMANTIC_CHECKSUM,
  DEFAULT_BASELINE_FILE_PATH,
  EMPTY_SCHEMA_SNAPSHOT_SQL,
  BaselineSchemaVerifierError,
  calculateSha256,
  createBaselineSchemaVerifier,
  evaluateEmptySchemaSnapshot,
  normalizeSchemaDump,
  normalizeSemanticSchemaDump,
  verifyCanonicalBaselineFile,
  verifyEmptySchema,
  verifySchemaDumpAgainstCanonical,
};
