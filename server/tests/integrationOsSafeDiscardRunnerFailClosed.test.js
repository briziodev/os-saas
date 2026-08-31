const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const SERVER_ROOT =
  path.resolve(__dirname, "..");

const RUNNER =
  path.join(
    SERVER_ROOT,
    "tests",
    "integration",
    "osSafeDiscard.integration.js"
  );

function runRunner(envOverrides) {
  const childEnv = {
    ...process.env,
  };

  for (const name of [
    "DATABASE_URL",
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
    "OS_SAAS_INTEGRATION_TEST",
  ]) {
    delete childEnv[name];
  }

  Object.assign(
    childEnv,
    envOverrides
  );

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [RUNNER],
      {
        cwd: SERVER_ROOT,
        env: childEnv,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);

    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

test(
  "runner safe discard rejeita banco local normal antes de carregar db.js",
  async () => {
    const result = await runRunner({
      DATABASE_URL: "",
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_NAME: "os_saas",
      OS_SAAS_INTEGRATION_TEST: "1",
    });

    assert.notEqual(
      result.exitCode,
      0
    );

    const output =
      `${result.stdout}\n${result.stderr}`;

    assert.match(
      output,
      /os_saas_test/
    );

    assert.doesNotMatch(
      output,
      /SERVER_STARTED/
    );
  }
);

test(
  "runner safe discard rejeita host remoto antes de carregar db.js",
  async () => {
    const result = await runRunner({
      DATABASE_URL: "",
      DB_HOST: "db.example.invalid",
      DB_PORT: "5432",
      DB_NAME: "os_saas_test",
      OS_SAAS_INTEGRATION_TEST: "1",
    });

    assert.notEqual(
      result.exitCode,
      0
    );

    const output =
      `${result.stdout}\n${result.stderr}`;

    assert.match(
      output,
      /somente PostgreSQL local/
    );

    assert.doesNotMatch(
      output,
      /SERVER_STARTED/
    );
  }
);