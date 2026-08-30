const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUIRED_TABLE_COLUMNS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  evaluateSchemaSnapshot,
  createSchemaReadinessChecker,
} = require("../services/schemaReadiness");

function buildCompatibleSnapshot() {
  const columns = [];

  for (
    const [tableName, requiredColumns]
    of Object.entries(
      REQUIRED_TABLE_COLUMNS
    )
  ) {
    for (
      const columnName
      of requiredColumns
    ) {
      columns.push({
        table_name: tableName,
        column_name: columnName,
      });
    }
  }

  return {
    columns,

    constraints:
      REQUIRED_CONSTRAINTS.map(
        (name) => ({
          name,
          validated: true,
        })
      ),

    indexes: [
      ...REQUIRED_INDEXES,
    ],
  };
}

test(
  "aprova um schema compatível",
  () => {
    const result =
      evaluateSchemaSnapshot(
        buildCompatibleSnapshot()
      );

    assert.equal(
      result.compatible,
      true
    );

    assert.deepEqual(
      result.missingTables,
      []
    );

    assert.deepEqual(
      result.missingColumns,
      []
    );
  }
);

test(
  "reprova tabela obrigatória ausente",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.columns =
      snapshot.columns.filter(
        (item) =>
          item.table_name !==
          "password_reset_tokens"
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(
      result.compatible,
      false
    );

    assert.deepEqual(
      result.missingTables,
      ["password_reset_tokens"]
    );
  }
);

test(
  "reprova coluna crítica ausente",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.columns =
      snapshot.columns.filter(
        (item) =>
          !(
            item.table_name === "users" &&
            item.column_name ===
              "session_version"
          )
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(
      result.compatible,
      false
    );

    assert.ok(
      result.missingColumns.includes(
        "users.session_version"
      )
    );
  }
);

test(
  "reprova constraint não validada",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.constraints =
      snapshot.constraints.map(
        (item) =>
          item.name ===
          "users_session_version_positive"
            ? {
                ...item,
                validated: false,
              }
            : item
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(
      result.compatible,
      false
    );

    assert.ok(
      result.invalidConstraints.includes(
        "users_session_version_positive"
      )
    );
  }
);

test(
  "reprova índice obrigatório ausente",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.indexes =
      snapshot.indexes.filter(
        (name) =>
          name !==
          "password_reset_tokens_one_pending_per_user_idx"
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(
      result.compatible,
      false
    );

    assert.ok(
      result.missingIndexes.includes(
        "password_reset_tokens_one_pending_per_user_idx"
      )
    );
  }
);
test(
  "reprova tabela audit_logs ausente",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.columns =
      snapshot.columns.filter(
        (item) =>
          item.table_name !==
          "audit_logs"
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(
      result.compatible,
      false
    );

    assert.ok(
      result.missingTables.includes(
        "audit_logs"
      )
    );
  }
);

test(
  "reprova índice de retenção de auditoria ausente",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.indexes =
      snapshot.indexes.filter(
        (name) =>
          name !==
          "idx_audit_logs_created_at"
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(
      result.compatible,
      false
    );

    assert.ok(
      result.missingIndexes.includes(
        "idx_audit_logs_created_at"
      )
    );
  }
);

test(
  "reutiliza o resultado dentro do TTL",
  async () => {
    const snapshot =
      buildCompatibleSnapshot();

    let queryCount = 0;
    let currentTime = 1_000;

    const fakePool = {
      async query() {
        queryCount += 1;

        return {
          rows: [
            {
              schema_snapshot: snapshot,
            },
          ],
        };
      },
    };

    const checker =
      createSchemaReadinessChecker(
        fakePool,
        {
          ttlMs: 30_000,
          now: () => currentTime,
        }
      );

    const first = await checker.check();
    const second = await checker.check();

    assert.equal(first.compatible, true);
    assert.equal(second.compatible, true);
    assert.equal(queryCount, 1);
  }
);

test(
  "refaz a consulta após expirar o TTL",
  async () => {
    const snapshot =
      buildCompatibleSnapshot();

    let queryCount = 0;
    let currentTime = 1_000;

    const fakePool = {
      async query() {
        queryCount += 1;

        return {
          rows: [
            {
              schema_snapshot: snapshot,
            },
          ],
        };
      },
    };

    const checker =
      createSchemaReadinessChecker(
        fakePool,
        {
          ttlMs: 30_000,
          now: () => currentTime,
        }
      );

    await checker.check();

    currentTime = 31_001;

    await checker.check();

    assert.equal(queryCount, 2);
  }
);

test(
  "compartilha uma consulta entre chamadas simultâneas",
  async () => {
    const snapshot =
      buildCompatibleSnapshot();

    let queryCount = 0;
    let resolveQuery;

    const pendingQuery = new Promise(
      (resolve) => {
        resolveQuery = resolve;
      }
    );

    const fakePool = {
      query() {
        queryCount += 1;
        return pendingQuery;
      },
    };

    const checker =
      createSchemaReadinessChecker(
        fakePool,
        {
          ttlMs: 30_000,
        }
      );

    const firstCheck = checker.check();
    const secondCheck = checker.check();

    assert.equal(queryCount, 1);

    resolveQuery({
      rows: [
        {
          schema_snapshot: snapshot,
        },
      ],
    });

    const [first, second] =
      await Promise.all([
        firstCheck,
        secondCheck,
      ]);

    assert.equal(first.compatible, true);
    assert.equal(second.compatible, true);
    assert.equal(queryCount, 1);
  }
);

test(
  "contrato exige campos de arquivamento de clientes",
  () => {
    assert.deepEqual(
      REQUIRED_TABLE_COLUMNS.clientes.filter(
        (columnName) =>
          [
            "archived_at",
            "archived_by",
            "archive_reason",
          ].includes(columnName)
      ),
      [
        "archived_at",
        "archived_by",
        "archive_reason",
      ]
    );
  }
);

test(
  "reprova schema sem archived_at de clientes",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.columns =
      snapshot.columns.filter(
        (item) =>
          !(
            item.table_name === "clientes" &&
            item.column_name === "archived_at"
          )
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(result.compatible, false);
    assert.ok(
      result.missingColumns.includes(
        "clientes.archived_at"
      )
    );
  }
);

test(
  "reprova schema sem constraint de estado do arquivamento",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.constraints =
      snapshot.constraints.filter(
        (item) =>
          item.name !==
          "clientes_archival_state_consistent"
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(result.compatible, false);
    assert.ok(
      result.missingConstraints.includes(
        "clientes_archival_state_consistent"
      )
    );
  }
);

test(
  "reprova schema sem indice de clientes ativos",
  () => {
    const snapshot =
      buildCompatibleSnapshot();

    snapshot.indexes =
      snapshot.indexes.filter(
        (name) =>
          name !==
          "idx_clientes_company_active"
      );

    const result =
      evaluateSchemaSnapshot(snapshot);

    assert.equal(result.compatible, false);
    assert.ok(
      result.missingIndexes.includes(
        "idx_clientes_company_active"
      )
    );
  }
);
