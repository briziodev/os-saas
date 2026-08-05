const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  HISTORICAL_BASELINE_FILES,
  buildMigrationPlan,
  discoverMigrations,
} = require(
  "../database/migrationCatalog"
);

const CANONICAL_BASELINE_FILENAME =
  "20260802000000_baseline_current_schema.sql";

test(
  "baseline canônica nunca é tratada como migration incremental",
  async () => {
    assert.equal(
      HISTORICAL_BASELINE_FILES.includes(
        CANONICAL_BASELINE_FILENAME
      ),
      true
    );

    const migrations =
      await discoverMigrations({
        migrationsDirectory:
          path.join(
            __dirname,
            "..",
            "migrations",
            "versions"
          ),
      });

    const baseline =
      migrations.find(
        (migration) =>
          migration.filename ===
          CANONICAL_BASELINE_FILENAME
      );

    assert.ok(
      baseline,
      "Baseline canônica não encontrada."
    );

    assert.equal(
      baseline.historicalBaseline,
      true
    );

    assert.equal(
      baseline.containsTransactionControl,
      false
    );

    const plan =
      buildMigrationPlan({
        migrations,
        appliedRows: [],
      });

    assert.deepEqual(
      plan.baselinePending.map(
        (migration) =>
          migration.filename
      ),
      [
        CANONICAL_BASELINE_FILENAME,
      ]
    );

    assert.equal(
      plan.executablePending.some(
        (migration) =>
          migration.filename ===
          CANONICAL_BASELINE_FILENAME
      ),
      false
    );
  }
);