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
      createFakeClient();

    await ensureMetadataTable(client);

    assert.equal(
      client.calls.length,
      1
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
      createFakeClient((call) => {
        if (
          call.text.includes(
            "to_regclass"
          )
        ) {
          return {
            rows: [
              {
                exists: true,
              },
            ],
          };
        }

        return {
          rows,
        };
      });

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
      2
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
