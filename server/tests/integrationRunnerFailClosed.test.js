const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  spawnSync,
} = require("node:child_process");

const SERVER_ROOT = path.resolve(__dirname, "..");
const RUNNER_PATH = path.join(
  SERVER_ROOT,
  "tests",
  "integration",
  "osCancelled.integration.js"
);

function runBlockedIntegration({
  dbHost,
  dbName,
  confirmation,
}) {
  const tempDir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "os-saas-db-load-trap-"
    )
  );

  const preloadPath = path.join(
    tempDir,
    "block-db-load.cjs"
  );

  const preloadSource = `
const Module = require("node:module");
const originalLoad = Module._load;

Module._load = function patchedLoad(
  request,
  parent,
  isMain
) {
  if (
    request === "../../db" &&
    parent &&
    /tests[\\\\/]integration[\\\\/]osCancelled\\.integration\\.js$/.test(
      parent.filename
    )
  ) {
    process.stderr.write(
      "DB_LOAD_TRAP_TRIGGERED\\n"
    );

    throw new Error(
      "DB_LOAD_TRAP_TRIGGERED"
    );
  }

  return originalLoad.call(
    this,
    request,
    parent,
    isMain
  );
};
`;

  fs.writeFileSync(
    preloadPath,
    preloadSource,
    "utf8"
  );

  try {
    return spawnSync(
      process.execPath,
      [RUNNER_PATH],
      {
        cwd: SERVER_ROOT,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          NODE_ENV: "test",
          NODE_OPTIONS:
            `--require=${preloadPath}`,
          DATABASE_URL: "",
          DB_HOST: dbHost,
          DB_PORT: "5432",
          DB_NAME: dbName,
          OS_SAAS_INTEGRATION_TEST:
            confirmation,
        },
      }
    );
  } finally {
    fs.rmSync(
      tempDir,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

test(
  "runner rejeita banco local normal antes de carregar db.js",
  () => {
    const result = runBlockedIntegration({
      dbHost: "127.0.0.1",
      dbName: "os_saas",
      confirmation: "1",
    });

    const output =
      `${result.stdout || ""}\n${result.stderr || ""}`;

    assert.equal(
      result.status,
      1,
      `Exit code inesperado. Saida: ${output}`
    );

    assert.match(
      output,
      /banco dedicado de integração obrigatório/
    );

    assert.doesNotMatch(
      output,
      /DB_LOAD_TRAP_TRIGGERED/
    );
  }
);

test(
  "runner rejeita host remoto antes de carregar db.js",
  () => {
    const result = runBlockedIntegration({
      dbHost: "db.example.com",
      dbName: "os_saas_test",
      confirmation: "1",
    });

    const output =
      `${result.stdout || ""}\n${result.stderr || ""}`;

    assert.equal(
      result.status,
      1,
      `Exit code inesperado. Saida: ${output}`
    );

    assert.match(
      output,
      /somente PostgreSQL local é permitido/
    );

    assert.doesNotMatch(
      output,
      /DB_LOAD_TRAP_TRIGGERED/
    );
  }
);