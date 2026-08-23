const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SERVER_ROOT = path.resolve(__dirname, "..");
const RUNNER_PATH = path.join(
  SERVER_ROOT,
  "tests",
  "integration",
  "clientesMultiTenantIsolation.integration.js"
);
const DB_PATH = path.join(
  SERVER_ROOT,
  "db.js"
);

function combinedOutput(result) {
  return [
    result.stdout || "",
    result.stderr || "",
    result.error
      ? String(result.error.message || result.error)
      : "",
  ].join("\n");
}

function runRejectedTarget({
  host,
  database,
}) {
  const tempDir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "os-saas-clientes-failclosed-"
    )
  );

  const preloadPath = path.join(
    tempDir,
    "trap-db-load.cjs"
  );

  const preloadSource = `
const Module = require("node:module");
const path = require("node:path");

const target = path.resolve(
  process.env.OS_SAAS_TRAP_DB_PATH
);

const originalLoad = Module._load;

Module._load = function (
  request,
  parent,
  isMain
) {
  let resolved = null;

  try {
    resolved = Module._resolveFilename(
      request,
      parent,
      isMain
    );
  } catch {
    resolved = null;
  }

  if (
    typeof resolved === "string" &&
    path.isAbsolute(resolved) &&
    path.resolve(resolved) === target
  ) {
    throw new Error(
      "DB_MODULE_LOADED_BEFORE_GUARD"
    );
  }

  return originalLoad.apply(
    this,
    arguments
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
      [
        "--require",
        preloadPath,
        RUNNER_PATH,
      ],
      {
        cwd: SERVER_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: "",
          DB_HOST: host,
          DB_PORT: "5432",
          DB_USER: "fake_user",
          DB_PASSWORD: "fake_password",
          DB_NAME: database,
          NODE_ENV: "test",
          OS_SAAS_INTEGRATION_TEST: "1",
          OS_SAAS_TRAP_DB_PATH: DB_PATH,
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
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
  "runner clientes multi-tenant rejeita banco local normal antes de carregar db.js",
  () => {
    const result = runRejectedTarget({
      host: "localhost",
      database: "os_saas",
    });

    const output =
      combinedOutput(result);

    assert.notEqual(
      result.status,
      0,
      "Runner deveria rejeitar o banco local normal."
    );

    assert.match(
      output,
      /Database esperado: os_saas_test\./
    );

    assert.doesNotMatch(
      output,
      /DB_MODULE_LOADED_BEFORE_GUARD/
    );
  }
);

test(
  "runner clientes multi-tenant rejeita host remoto antes de carregar db.js",
  () => {
    const result = runRejectedTarget({
      host: "db.example.test",
      database: "os_saas_test",
    });

    const output =
      combinedOutput(result);

    assert.notEqual(
      result.status,
      0,
      "Runner deveria rejeitar host remoto."
    );

    assert.match(
      output,
      /Host encontrado: db\.example\.test\./
    );

    assert.doesNotMatch(
      output,
      /DB_MODULE_LOADED_BEFORE_GUARD/
    );
  }
);
