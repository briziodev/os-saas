const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CREATE_METADATA_TABLE_SQL,
  MIGRATION_LOCK_KEYS,
  MigrationStoreError,
  acquireMigrationLock,
  ensureMetadataTable,
  normalizeMigrationRecord,
  readMigrationState,
  recordAppliedMigration,
  releaseMigrationLock,
  validateMetadataTableContract,
} = require(
  "../database/migrationStore"
);

function createFakeClient(handler) {
  const calls = [];

  return {
    calls,

    async query(text, values) {
      const call = {
        text,
        values,
      };

      calls.push(call);

      if (handler) {
        return handler(call, calls);
      }

      return {
        rows: [],
      };
    },
  };
}

const VALID_METADATA_COLUMNS = [
  {
    column_name: "id",
    data_type: "text",
    not_null: true,
    column_default: null,
    relation_kind: "r",
  },
  {
    column_name: "filename",
    data_type: "text",
    not_null: true,
    column_default: null,
    relation_kind: "r",
  },
  {
    column_name: "checksum",
    data_type: "character(64)",
    not_null: true,
    column_default: null,
    relation_kind: "r",
  },
  {
    column_name: "baseline",
    data_type: "boolean",
    not_null: true,
    column_default: "false",
    relation_kind: "r",
  },
  {
    column_name: "execution_ms",
    data_type: "integer",
    not_null: true,
    column_default: "0",
    relation_kind: "r",
  },
  {
    column_name: "applied_at",
    data_type:
      "timestamp with time zone",
    not_null: true,
    column_default: "now()",
    relation_kind: "r",
  },
];

const VALID_METADATA_CONSTRAINTS = [
  {
    constraint_name:
      "schema_migrations_pkey",
    constraint_type: "p",
    deferrable: false,
    deferred: false,
    enforced: true,
    validated: true,
    columns: ["id"],
    definition:
      "PRIMARY KEY (id)",
  },
  {
    constraint_name:
      "schema_migrations_filename_key",
    constraint_type: "u",
    deferrable: false,
    deferred: false,
    enforced: true,
    validated: true,
    columns: ["filename"],
    definition:
      "UNIQUE (filename)",
  },
  {
    constraint_name:
      "schema_migrations_checksum_format",
    constraint_type: "c",
    deferrable: false,
    deferred: false,
    enforced: true,
    validated: true,
    columns: ["checksum"],
    definition:
      "CHECK ((checksum ~ '^[a-f0-9]{64}$'::text))",
  },
  {
    constraint_name:
      "schema_migrations_execution_ms_nonnegative",
    constraint_type: "c",
    deferrable: false,
    deferred: false,
    enforced: true,
    validated: true,
    columns: ["execution_ms"],
    definition:
      "CHECK ((execution_ms >= 0))",
  },
];

function createMetadataContractHandler(
  options = {}
) {
  const exists =
    options.exists ?? true;

  const columns =
    options.columns ??
    VALID_METADATA_COLUMNS;

  const constraints =
    options.constraints ??
    VALID_METADATA_CONSTRAINTS;

  const appliedRows =
    options.appliedRows ?? [];

  return (call) => {
    if (
      call.text.includes(
        "to_regclass"
      )
    ) {
      return {
        rows: [
          {
            exists,
          },
        ],
      };
    }

    /*
     * IMPORTANTE:
     * verificar pg_constraint ANTES
     * de pg_attribute.
     *
     * A query de constraints tambem
     * utiliza pg_attribute internamente.
     */
    if (
      call.text.includes(
        "pg_catalog.pg_constraint"
      )
    ) {
      return {
        rows: constraints,
      };
    }

    if (
      call.text.includes(
        "pg_catalog.pg_attribute"
      )
    ) {
      return {
        rows: columns,
      };
    }

    if (
      call.text.includes("FROM") &&
      call.text.includes(
        "public.schema_migrations"
      ) &&
      call.text.includes(
        "applied_at"
      )
    ) {
      return {
        rows: appliedRows,
      };
    }

    return {
      rows: [],
    };
  };
}

test(
  "validateMetadataTableContract aprova contrato compativel",
  async () => {
    const client =
      createFakeClient(
        createMetadataContractHandler()
      );

    const valid =
      await validateMetadataTableContract(
        client
      );

    assert.equal(valid, true);

    assert.equal(
      client.calls.length,
      2
    );
  }
);

test(
  "validateMetadataTableContract rejeita coluna ausente",
  async () => {
    const columns =
      VALID_METADATA_COLUMNS.filter(
        (column) =>
          column.column_name !==
          "checksum"
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          columns,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "INVALID_METADATA_TABLE_CONTRACT"
        );

        assert.ok(
          error.details.issues.includes(
            "MISSING_COLUMN:checksum"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita tipo incompativel",
  async () => {
    const columns =
      VALID_METADATA_COLUMNS.map(
        (column) =>
          column.column_name ===
          "checksum"
            ? {
                ...column,
                data_type: "text",
              }
            : column
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          columns,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_COLUMN_TYPE:checksum"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita nullability incompativel",
  async () => {
    const columns =
      VALID_METADATA_COLUMNS.map(
        (column) =>
          column.column_name ===
          "baseline"
            ? {
                ...column,
                not_null: false,
              }
            : column
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          columns,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_NULLABILITY:baseline"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita default incompativel",
  async () => {
    const columns =
      VALID_METADATA_COLUMNS.map(
        (column) =>
          column.column_name ===
          "execution_ms"
            ? {
                ...column,
                column_default: "1",
              }
            : column
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          columns,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_DEFAULT:execution_ms"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita constraint incompativel",
  async () => {
    const constraints =
      VALID_METADATA_CONSTRAINTS.filter(
        (constraint) =>
          constraint.constraint_type !==
          "u"
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          constraints,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_FILENAME_UNIQUE"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract consulta comportamento das constraints",
  async () => {
    const client =
      createFakeClient(
        createMetadataContractHandler()
      );

    await validateMetadataTableContract(
      client
    );

    const sql =
      client.calls[1].text;

    assert.match(
      sql,
      /condeferrable/
    );

    assert.match(
      sql,
      /condeferred/
    );

    assert.match(
      sql,
      /conenforced/
    );

    assert.match(
      sql,
      /convalidated/
    );

    assert.match(
      sql,
      /attribute\.attname::text/
    );
  }
);

test(
  "validateMetadataTableContract rejeita regex uppercase no checksum",
  async () => {
    const constraints =
      VALID_METADATA_CONSTRAINTS.map(
        (constraint) =>
          constraint.constraint_name ===
          "schema_migrations_checksum_format"
            ? {
                ...constraint,
                definition:
                  "CHECK ((checksum ~ '^[A-F0-9]{64}$'::text))",
              }
            : constraint
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          constraints,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_CHECKSUM_CONSTRAINT"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita checksum CHECK nao enforced",
  async () => {
    const constraints =
      VALID_METADATA_CONSTRAINTS.map(
        (constraint) =>
          constraint.constraint_name ===
          "schema_migrations_checksum_format"
            ? {
                ...constraint,
                enforced: false,
              }
            : constraint
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          constraints,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_CHECKSUM_CONSTRAINT"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita execution CHECK nao validado",
  async () => {
    const constraints =
      VALID_METADATA_CONSTRAINTS.map(
        (constraint) =>
          constraint.constraint_name ===
          "schema_migrations_execution_ms_nonnegative"
            ? {
                ...constraint,
                validated: false,
              }
            : constraint
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          constraints,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_EXECUTION_MS_CONSTRAINT"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita UNIQUE deferrable",
  async () => {
    const constraints =
      VALID_METADATA_CONSTRAINTS.map(
        (constraint) =>
          constraint.constraint_type ===
          "u"
            ? {
                ...constraint,
                deferrable: true,
              }
            : constraint
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          constraints,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_FILENAME_UNIQUE"
          )
        );

        return true;
      }
    );
  }
);

test(
  "validateMetadataTableContract rejeita CHECK execution_ms alterado",
  async () => {
    const constraints =
      VALID_METADATA_CONSTRAINTS.map(
        (constraint) =>
          constraint.constraint_name ===
          "schema_migrations_execution_ms_nonnegative"
            ? {
                ...constraint,
                definition:
                  "CHECK ((execution_ms >= -1))",
              }
            : constraint
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          constraints,
        })
      );

    await assert.rejects(
      () =>
        validateMetadataTableContract(
          client
        ),
      (error) => {
        assert.ok(
          error.details.issues.includes(
            "INVALID_EXECUTION_MS_CONSTRAINT"
          )
        );

        return true;
      }
    );
  }
);

test(
  "ensureMetadataTable rejeita metadata malformada apos DDL",
  async () => {
    const columns =
      VALID_METADATA_COLUMNS.filter(
        (column) =>
          column.column_name !==
          "checksum"
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          columns,
        })
      );

    await assert.rejects(
      () =>
        ensureMetadataTable(client),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "INVALID_METADATA_TABLE_CONTRACT"
        );

        return true;
      }
    );

    assert.equal(
      client.calls[0].text,
      CREATE_METADATA_TABLE_SQL
    );

    assert.equal(
      client.calls.length,
      3
    );
  }
);

test(
  "readMigrationState rejeita metadata existente incompativel",
  async () => {
    const columns =
      VALID_METADATA_COLUMNS.filter(
        (column) =>
          column.column_name !==
          "filename"
      );

    const client =
      createFakeClient(
        createMetadataContractHandler({
          columns,
        })
      );

    await assert.rejects(
      () =>
        readMigrationState(client),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "INVALID_METADATA_TABLE_CONTRACT"
        );

        assert.ok(
          error.details.issues.includes(
            "MISSING_COLUMN:filename"
          )
        );

        return true;
      }
    );

    assert.equal(
      client.calls.length,
      3
    );
  }
);
test(
  "normalizeMigrationRecord normaliza valores válidos",
  () => {
    const result =
      normalizeMigrationRecord({
        id: " 20260802_example ",
        filename:
          " 20260802_example.sql ",
        checksum:
          "A".repeat(64),
        baseline: true,
        executionMs: 12,
      });

    assert.deepEqual(result, {
      id: "20260802_example",
      filename:
        "20260802_example.sql",
      checksum:
        "a".repeat(64),
      baseline: true,
      executionMs: 12,
    });
  }
);

test(
  "normalizeMigrationRecord rejeita checksum inválido",
  () => {
    assert.throws(
      () =>
        normalizeMigrationRecord({
          id: "20260802_example",
          filename:
            "20260802_example.sql",
          checksum: "invalido",
        }),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "INVALID_MIGRATION_CHECKSUM"
        );

        return true;
      }
    );
  }
);

test(
  "normalizeMigrationRecord rejeita baseline textual",
  () => {
    assert.throws(
      () =>
        normalizeMigrationRecord({
          id: "20260802_example",
          filename:
            "20260802_example.sql",
          checksum:
            "a".repeat(64),
          baseline: "false",
        }),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "INVALID_MIGRATION_BASELINE"
        );

        return true;
      }
    );
  }
);

test(
  "normalizeMigrationRecord rejeita executionMs textual",
  () => {
    assert.throws(
      () =>
        normalizeMigrationRecord({
          id: "20260802_example",
          filename:
            "20260802_example.sql",
          checksum:
            "a".repeat(64),
          executionMs: "12",
        }),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "INVALID_MIGRATION_EXECUTION_TIME"
        );

        return true;
      }
    );
  }
);

test(
  "ensureMetadataTable executa DDL controlado",
  async () => {
    const client =
      createFakeClient(
        createMetadataContractHandler()
      );

    await ensureMetadataTable(client);

    assert.equal(
      client.calls.length,
      3
    );

    assert.equal(
      client.calls[0].text,
      CREATE_METADATA_TABLE_SQL
    );

    assert.match(
      client.calls[0].text,
      /CREATE TABLE IF NOT EXISTS/
    );

    assert.match(
      client.calls[0].text,
      /schema_migrations_checksum_format/
    );
  }
);

test(
  "readMigrationState informa tabela ausente",
  async () => {
    const client =
      createFakeClient(() => ({
        rows: [
          {
            exists: false,
          },
        ],
      }));

    const state =
      await readMigrationState(client);

    assert.deepEqual(state, {
      metadataTableExists: false,
      appliedRows: [],
    });

    assert.equal(
      client.calls.length,
      1
    );
  }
);

test(
  "readMigrationState retorna migrations aplicadas",
  async () => {
    const rows = [
      {
        id: "20260802_example",
        filename:
          "20260802_example.sql",
        checksum:
          "a".repeat(64),
        baseline: false,
        execution_ms: 19,
        applied_at:
          new Date(
            "2026-08-02T12:00:00Z"
          ),
      },
    ];

    const client =
      createFakeClient(
        createMetadataContractHandler({
          appliedRows: rows,
        })
      );

    const state =
      await readMigrationState(client);

    assert.equal(
      state.metadataTableExists,
      true
    );

    assert.deepEqual(
      state.appliedRows,
      rows
    );

    assert.equal(
      client.calls.length,
      4
    );
  }
);

test(
  "recordAppliedMigration utiliza parâmetros",
  async () => {
    const returnedRow = {
      id: "20260802_example",
      filename:
        "20260802_example.sql",
      checksum:
        "a".repeat(64),
      baseline: false,
      execution_ms: 25,
      applied_at:
        new Date(
          "2026-08-02T12:00:00Z"
        ),
    };

    const client =
      createFakeClient(() => ({
        rows: [
          returnedRow,
        ],
      }));

    const result =
      await recordAppliedMigration(
        client,
        {
          id:
            "20260802_example",
          filename:
            "20260802_example.sql",
          checksum:
            "a".repeat(64),
          baseline: false,
          executionMs: 25,
        }
      );

    assert.deepEqual(
      result,
      returnedRow
    );

    assert.deepEqual(
      client.calls[0].values,
      [
        "20260802_example",
        "20260802_example.sql",
        "a".repeat(64),
        false,
        25,
      ]
    );

    assert.match(
      client.calls[0].text,
      /\$1/
    );

    assert.doesNotMatch(
      client.calls[0].text,
      /20260802_example/
    );
  }
);

test(
  "recordAppliedMigration exige linha retornada",
  async () => {
    const client =
      createFakeClient(() => ({
        rows: [],
      }));

    await assert.rejects(
      () =>
        recordAppliedMigration(
          client,
          {
            id:
              "20260802_example",
            filename:
              "20260802_example.sql",
            checksum:
              "a".repeat(64),
            baseline: false,
            executionMs: 10,
          }
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "MIGRATION_RECORD_NOT_RETURNED"
        );

        return true;
      }
    );
  }
);

test(
  "acquireMigrationLock obtém lock não bloqueante",
  async () => {
    const client =
      createFakeClient(() => ({
        rows: [
          {
            acquired: true,
          },
        ],
      }));

    const acquired =
      await acquireMigrationLock(
        client
      );

    assert.equal(acquired, true);

    assert.deepEqual(
      client.calls[0].values,
      MIGRATION_LOCK_KEYS
    );

    assert.match(
      client.calls[0].text,
      /pg_try_advisory_lock/
    );
  }
);

test(
  "acquireMigrationLock suporta espera explícita",
  async () => {
    const client =
      createFakeClient(() => ({
        rows: [
          {},
        ],
      }));

    const acquired =
      await acquireMigrationLock(
        client,
        {
          wait: true,
        }
      );

    assert.equal(acquired, true);

    assert.deepEqual(
      client.calls[0].values,
      MIGRATION_LOCK_KEYS
    );

    assert.match(
      client.calls[0].text,
      /pg_advisory_lock/
    );

    assert.doesNotMatch(
      client.calls[0].text,
      /pg_try_advisory_lock/
    );
  }
);

test(
  "acquireMigrationLock rejeita concorrência",
  async () => {
    const client =
      createFakeClient(() => ({
        rows: [
          {
            acquired: false,
          },
        ],
      }));

    await assert.rejects(
      () =>
        acquireMigrationLock(client),
      (error) => {
        assert.ok(
          error instanceof
            MigrationStoreError
        );

        assert.equal(
          error.code,
          "MIGRATION_LOCK_UNAVAILABLE"
        );

        return true;
      }
    );
  }
);

test(
  "releaseMigrationLock utiliza as mesmas chaves",
  async () => {
    const client =
      createFakeClient(() => ({
        rows: [
          {
            released: true,
          },
        ],
      }));

    const released =
      await releaseMigrationLock(
        client
      );

    assert.equal(released, true);

    assert.deepEqual(
      client.calls[0].values,
      MIGRATION_LOCK_KEYS
    );

    assert.match(
      client.calls[0].text,
      /pg_advisory_unlock/
    );
  }
);
