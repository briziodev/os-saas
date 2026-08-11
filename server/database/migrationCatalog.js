const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MIGRATION_FILE_PATTERN =
  /^(?<version>\d{8}(?:\d{6})?)_(?<name>[a-z0-9][a-z0-9_-]*)\.sql$/;

const DOWN_MIGRATION_PATTERN =
  /_down\.sql$/;

const TRANSACTION_CONTROL_PATTERN =
  /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\b/im;

/*
 * Estas migrations foram aplicadas manualmente antes da
 * existência do runner. Elas deverão ser registradas por
 * baseline e nunca executadas automaticamente em bancos
 * existentes.
 */
const HISTORICAL_BASELINE_FILES = Object.freeze([
  "20260802000000_baseline_current_schema.sql",
  "20260510_create_os_events.sql",
  "20260717_password_security_up.sql",
]);

const HISTORICAL_BASELINE_FILE_SET =
  new Set(HISTORICAL_BASELINE_FILES);

class MigrationCatalogError extends Error {
  constructor(code, message, details = {}) {
    super(message);

    this.name = "MigrationCatalogError";
    this.code = code;
    this.details = details;
  }
}

function calculateChecksum(content) {
  const buffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(String(content), "utf8");

  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function containsTransactionControl(sql) {
  return TRANSACTION_CONTROL_PATTERN.test(
    String(sql || "")
  );
}

function parseMigrationFilename(filename) {
  const normalizedFilename =
    String(filename || "").trim();

  const match = MIGRATION_FILE_PATTERN.exec(
    normalizedFilename
  );

  if (!match || !match.groups) {
    throw new MigrationCatalogError(
      "INVALID_MIGRATION_FILENAME",
      `Nome de migration inválido: ${normalizedFilename}`,
      {
        filename: normalizedFilename,
      }
    );
  }

  return {
    id: normalizedFilename.slice(
      0,
      -path.extname(normalizedFilename).length
    ),
    filename: normalizedFilename,
    version: match.groups.version,
    name: match.groups.name,
  };
}

async function discoverMigrations(options = {}) {
  const migrationsDirectory =
    options.migrationsDirectory;

  if (
    typeof migrationsDirectory !== "string" ||
    !migrationsDirectory.trim()
  ) {
    throw new TypeError(
      "migrationsDirectory é obrigatório."
    );
  }

  const absoluteDirectory = path.resolve(
    migrationsDirectory
  );

  let directoryEntries;

  try {
    directoryEntries = await fs.readdir(
      absoluteDirectory,
      {
        withFileTypes: true,
      }
    );
  } catch (error) {
    throw new MigrationCatalogError(
      "MIGRATIONS_DIRECTORY_UNAVAILABLE",
      "Não foi possível acessar o diretório de migrations.",
      {
        migrationsDirectory:
          absoluteDirectory,
        causeCode:
          error && error.code
            ? error.code
            : null,
      }
    );
  }

  const sqlFiles = directoryEntries
    .filter((entry) => {
      return (
        entry.isFile() &&
        entry.name.endsWith(".sql")
      );
    })
    .map((entry) => entry.name)
    .sort((left, right) =>
      left.localeCompare(right, "en")
    );

  const migrations = [];

  for (const filename of sqlFiles) {
    if (
      DOWN_MIGRATION_PATTERN.test(filename)
    ) {
      continue;
    }

    const parsed =
      parseMigrationFilename(filename);

    const filePath = path.join(
      absoluteDirectory,
      filename
    );

    const content = await fs.readFile(filePath);
    const sql = content.toString("utf8");

    if (!sql.trim()) {
      throw new MigrationCatalogError(
        "EMPTY_MIGRATION",
        `Migration vazia: ${filename}`,
        {
          filename,
        }
      );
    }

    migrations.push({
      ...parsed,
      filePath,
      checksum:
        calculateChecksum(content),
      sql,
      historicalBaseline:
        HISTORICAL_BASELINE_FILE_SET.has(
          filename
        ),
      containsTransactionControl:
        containsTransactionControl(sql),
    });
  }

  const migrationIds = new Set();

  for (const migration of migrations) {
    if (migrationIds.has(migration.id)) {
      throw new MigrationCatalogError(
        "DUPLICATE_MIGRATION_ID",
        `ID de migration duplicado: ${migration.id}`,
        {
          id: migration.id,
        }
      );
    }

    migrationIds.add(migration.id);
  }

  return migrations;
}

function normalizeAppliedRow(row) {
  const id = String(
    row && row.id ? row.id : ""
  ).trim();

  const filename = String(
    row && row.filename
      ? row.filename
      : ""
  ).trim();

  const checksum = String(
    row && row.checksum
      ? row.checksum
      : ""
  )
    .trim()
    .toLowerCase();

  const baseline =
    row && typeof row === "object"
      ? row.baseline
      : undefined;

  if (
    !id ||
    !filename ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    typeof baseline !== "boolean"
  ) {
    throw new MigrationCatalogError(
      "INVALID_APPLIED_MIGRATION_ROW",
      "Registro aplicado inválido.",
      {
        id: id || null,
        filename:
          filename || null,
      }
    );
  }

  return {
    id,
    filename,
    checksum,
    baseline,
    appliedAt:
      row.applied_at ||
      row.appliedAt ||
      null,
  };
}

function buildMigrationPlan(options = {}) {
  const migrations = Array.isArray(
    options.migrations
  )
    ? options.migrations
    : [];

  const appliedRows = Array.isArray(
    options.appliedRows
  )
    ? options.appliedRows.map(
        normalizeAppliedRow
      )
    : [];

  const migrationById = new Map(
    migrations.map((migration) => [
      migration.id,
      migration,
    ])
  );

  const appliedById = new Map(
    appliedRows.map((row) => [
      row.id,
      row,
    ])
  );

  const applied = [];
  const pending = [];
  const baselinePending = [];
  const executablePending = [];
  const checksumMismatches = [];
  const historyMismatches = [];
  const missingFiles = [];

  for (const migration of migrations) {
    const appliedRow =
      appliedById.get(migration.id);

    if (!appliedRow) {
      pending.push(migration);

      if (migration.historicalBaseline) {
        baselinePending.push(migration);
      } else {
        executablePending.push(migration);
      }

      continue;
    }

    let migrationHasMismatch = false;

    if (
      appliedRow.checksum !==
      migration.checksum.toLowerCase()
    ) {
      checksumMismatches.push({
        id: migration.id,
        filename: migration.filename,
        expectedChecksum:
          appliedRow.checksum,
        actualChecksum:
          migration.checksum.toLowerCase(),
      });

      migrationHasMismatch = true;
    }

    const mismatchFields = [];

    if (
      appliedRow.filename !==
      migration.filename
    ) {
      mismatchFields.push(
        "filename"
      );
    }

    const expectedBaseline =
      migration.historicalBaseline ===
      true;

    if (
      appliedRow.baseline !==
      expectedBaseline
    ) {
      mismatchFields.push(
        "baseline"
      );
    }

    if (mismatchFields.length > 0) {
      historyMismatches.push({
        id: migration.id,
        filename:
          migration.filename,
        fields:
          mismatchFields,
        appliedFilename:
          appliedRow.filename,
        catalogFilename:
          migration.filename,
        appliedBaseline:
          appliedRow.baseline,
        catalogBaseline:
          expectedBaseline,
      });

      migrationHasMismatch = true;
    }

    if (migrationHasMismatch) {
      continue;
    }

    applied.push({
      migration,
      appliedRow,
    });
  }

  for (const appliedRow of appliedRows) {
    if (!migrationById.has(appliedRow.id)) {
      missingFiles.push(appliedRow);
    }
  }

  return {
    applied,
    pending,
    baselinePending,
    executablePending,
    checksumMismatches,
    historyMismatches,
    missingFiles,
    hasDrift:
      checksumMismatches.length > 0 ||
      historyMismatches.length > 0 ||
      missingFiles.length > 0,
  };
}

module.exports = {
  DOWN_MIGRATION_PATTERN,
  HISTORICAL_BASELINE_FILES,
  MIGRATION_FILE_PATTERN,
  MigrationCatalogError,
  buildMigrationPlan,
  calculateChecksum,
  containsTransactionControl,
  discoverMigrations,
  parseMigrationFilename,
};