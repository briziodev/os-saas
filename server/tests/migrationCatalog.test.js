const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MigrationCatalogError,
  buildMigrationPlan,
  calculateChecksum,
  containsTransactionControl,
  discoverMigrations,
  parseMigrationFilename,
} = require(
  "../database/migrationCatalog"
);

async function createTemporaryDirectory() {
  return fs.mkdtemp(
    path.join(
      os.tmpdir(),
      "os-saas-migrations-"
    )
  );
}

async function writeMigration(
  directory,
  filename,
  sql
) {
  await fs.writeFile(
    path.join(directory, filename),
    sql,
    "utf8"
  );
}

test(
  "parseMigrationFilename aceita data e timestamp",
  () => {
    assert.deepEqual(
      parseMigrationFilename(
        "20260802_create_schema_migrations.sql"
      ),
      {
        id:
          "20260802_create_schema_migrations",
        filename:
          "20260802_create_schema_migrations.sql",
        version: "20260802",
        name: "create_schema_migrations",
      }
    );

    assert.deepEqual(
      parseMigrationFilename(
        "20260802124530_add_audit_logs.sql"
      ),
      {
        id:
          "20260802124530_add_audit_logs",
        filename:
          "20260802124530_add_audit_logs.sql",
        version: "20260802124530",
        name: "add_audit_logs",
      }
    );
  }
);

test(
  "parseMigrationFilename rejeita nome fora do padrão",
  () => {
    assert.throws(
      () =>
        parseMigrationFilename(
          "migration final.sql"
        ),
      (error) => {
        assert.ok(
          error instanceof
            MigrationCatalogError
        );

        assert.equal(
          error.code,
          "INVALID_MIGRATION_FILENAME"
        );

        return true;
      }
    );
  }
);

test(
  "calculateChecksum é determinístico e detecta alteração",
  () => {
    const first =
      calculateChecksum(
        "SELECT 1;\n"
      );

    const second =
      calculateChecksum(
        "SELECT 1;\n"
      );

    const changed =
      calculateChecksum(
        "SELECT 2;\n"
      );

    assert.equal(first, second);
    assert.notEqual(first, changed);
    assert.match(
      first,
      /^[a-f0-9]{64}$/
    );
  }
);

test(
  "containsTransactionControl detecta controle transacional",
  () => {
    assert.equal(
      containsTransactionControl(
        "BEGIN;\nALTER TABLE users ADD COLUMN example text;\nCOMMIT;"
      ),
      true
    );

    assert.equal(
      containsTransactionControl(
        "ALTER TABLE users ADD COLUMN example text;"
      ),
      false
    );
  }
);

test(
  "discoverMigrations ordena arquivos e ignora down",
  async (context) => {
    const directory =
      await createTemporaryDirectory();

    context.after(async () => {
      await fs.rm(directory, {
        recursive: true,
        force: true,
      });
    });

    await writeMigration(
      directory,
      "20260717_password_security_down.sql",
      "SELECT 1;"
    );

    await writeMigration(
      directory,
      "20260717_password_security_up.sql",
      "BEGIN;\nSELECT 1;\nCOMMIT;"
    );

    await writeMigration(
      directory,
      "20260510_create_os_events.sql",
      "CREATE TABLE os_events(id integer);"
    );

    await writeMigration(
      directory,
      "20260802124530_future_change.sql",
      "ALTER TABLE users ADD COLUMN example text;"
    );

    const migrations =
      await discoverMigrations({
        migrationsDirectory:
          directory,
      });

    assert.deepEqual(
      migrations.map(
        (migration) =>
          migration.filename
      ),
      [
        "20260510_create_os_events.sql",
        "20260717_password_security_up.sql",
        "20260802124530_future_change.sql",
      ]
    );

    assert.equal(
      migrations[0].historicalBaseline,
      true
    );

    assert.equal(
      migrations[1].historicalBaseline,
      true
    );

    assert.equal(
      migrations[1].containsTransactionControl,
      true
    );

    assert.equal(
      migrations[2].historicalBaseline,
      false
    );

    assert.equal(
      migrations[2].containsTransactionControl,
      false
    );
  }
);

test(
  "discoverMigrations rejeita SQL inválido no diretório",
  async (context) => {
    const directory =
      await createTemporaryDirectory();

    context.after(async () => {
      await fs.rm(directory, {
        recursive: true,
        force: true,
      });
    });

    await writeMigration(
      directory,
      "arquivo_sem_versao.sql",
      "SELECT 1;"
    );

    await assert.rejects(
      () =>
        discoverMigrations({
          migrationsDirectory:
            directory,
        }),
      (error) => {
        assert.equal(
          error.code,
          "INVALID_MIGRATION_FILENAME"
        );

        return true;
      }
    );
  }
);

test(
  "buildMigrationPlan separa baseline e migrations executáveis",
  () => {
    const migrations = [
      {
        id:
          "20260510_create_os_events",
        filename:
          "20260510_create_os_events.sql",
        checksum:
          "a".repeat(64),
        historicalBaseline: true,
      },
      {
        id:
          "20260717_password_security_up",
        filename:
          "20260717_password_security_up.sql",
        checksum:
          "b".repeat(64),
        historicalBaseline: true,
      },
      {
        id:
          "20260802_create_audit_logs",
        filename:
          "20260802_create_audit_logs.sql",
        checksum:
          "c".repeat(64),
        historicalBaseline: false,
      },
    ];

    const plan = buildMigrationPlan({
      migrations,
      appliedRows: [
        {
          id:
            "20260510_create_os_events",
          filename:
            "20260510_create_os_events.sql",
          checksum:
            "a".repeat(64),
          baseline: true,
        },
      ],
    });

    assert.equal(
      plan.applied.length,
      1
    );

    assert.deepEqual(
      plan.baselinePending.map(
        (migration) => migration.id
      ),
      [
        "20260717_password_security_up",
      ]
    );

    assert.deepEqual(
      plan.executablePending.map(
        (migration) => migration.id
      ),
      [
        "20260802_create_audit_logs",
      ]
    );

    assert.equal(
      plan.hasDrift,
      false
    );
  }
);

test(
  "buildMigrationPlan detecta checksum alterado e arquivo ausente",
  () => {
    const plan = buildMigrationPlan({
      migrations: [
        {
          id: "20260802_example",
          filename:
            "20260802_example.sql",
          checksum:
            "a".repeat(64),
          historicalBaseline: false,
        },
      ],
      appliedRows: [
        {
          id: "20260802_example",
          filename:
            "20260802_example.sql",
          checksum:
            "b".repeat(64),
          baseline: false,
        },
        {
          id:
            "20260803_missing_file",
          filename:
            "20260803_missing_file.sql",
          checksum:
            "c".repeat(64),
          baseline: false,
        },
      ],
    });

    assert.equal(
      plan.checksumMismatches.length,
      1
    );

    assert.equal(
      plan.missingFiles.length,
      1
    );

    assert.equal(
      plan.hasDrift,
      true
    );
  }
);
test(
  "buildMigrationPlan detecta filename divergente",
  () => {
    const plan = buildMigrationPlan({
      migrations: [
        {
          id: "20260802_example",
          filename:
            "20260802_example.sql",
          checksum:
            "a".repeat(64),
          historicalBaseline: false,
        },
      ],
      appliedRows: [
        {
          id: "20260802_example",
          filename:
            "20260802_outro_nome.sql",
          checksum:
            "a".repeat(64),
          baseline: false,
        },
      ],
    });

    assert.equal(
      plan.historyMismatches.length,
      1
    );

    assert.deepEqual(
      plan.historyMismatches[0].fields,
      ["filename"]
    );

    assert.equal(
      plan.applied.length,
      0
    );

    assert.equal(
      plan.hasDrift,
      true
    );
  }
);

test(
  "buildMigrationPlan detecta baseline divergente",
  () => {
    const plan = buildMigrationPlan({
      migrations: [
        {
          id:
            "20260802000000_baseline_current_schema",
          filename:
            "20260802000000_baseline_current_schema.sql",
          checksum:
            "a".repeat(64),
          historicalBaseline: true,
        },
      ],
      appliedRows: [
        {
          id:
            "20260802000000_baseline_current_schema",
          filename:
            "20260802000000_baseline_current_schema.sql",
          checksum:
            "a".repeat(64),
          baseline: false,
        },
      ],
    });

    assert.equal(
      plan.historyMismatches.length,
      1
    );

    assert.deepEqual(
      plan.historyMismatches[0].fields,
      ["baseline"]
    );

    assert.equal(
      plan.applied.length,
      0
    );

    assert.equal(
      plan.hasDrift,
      true
    );
  }
);

test(
  "buildMigrationPlan rejeita baseline textual no historico aplicado",
  () => {
    assert.throws(
      () =>
        buildMigrationPlan({
          migrations: [],
          appliedRows: [
            {
              id:
                "20260802_example",
              filename:
                "20260802_example.sql",
              checksum:
                "a".repeat(64),
              baseline:
                "false",
            },
          ],
        }),
      (error) => {
        assert.ok(
          error instanceof
            MigrationCatalogError
        );

        assert.equal(
          error.code,
          "INVALID_APPLIED_MIGRATION_ROW"
        );

        return true;
      }
    );
  }
);