const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  spawn,
} = require("node:child_process");

function runChild({
  cwd,
  dbPath,
}) {
  const childCode = [
    'const dbPath = process.argv[1];',
    'const pool = require(dbPath);',
    '',
    'Promise.resolve(pool.end())',
    '  .then(() => {',
    '    process.stdout.write("DB_MODULE_OK\\n");',
    '  })',
    '  .catch((error) => {',
    '    process.stderr.write(',
    '      String(',
    '        error?.message ||',
    '        "pool.end falhou"',
    '      )',
    '    );',
    '    process.exitCode = 1;',
    '  });',
    '',
  ].join("\n");

  const childEnv = {
    ...process.env,
  };

  for (
    const name of [
      "DATABASE_URL",
      "DB_HOST",
      "DB_PORT",
      "DB_USER",
      "DB_PASSWORD",
      "DB_NAME",
      "DOTENV_CONFIG_QUIET",
      "DOTENV_CONFIG_DEBUG",
      "DOTENV_CONFIG_PATH",
    ]
  ) {
    delete childEnv[name];
  }

  return new Promise(
    (
      resolve,
      reject
    ) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          childCode,
          dbPath,
        ],
        {
          cwd,
          env: childEnv,
          shell: false,
          windowsHide: true,
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        (chunk) => {
          stdout += chunk.toString(
            "utf8"
          );
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr += chunk.toString(
            "utf8"
          );
        }
      );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        (exitCode) => {
          resolve({
            exitCode,
            stdout,
            stderr,
          });
        }
      );
    }
  );
}

test(
  "db.js carrega dotenv sem contaminar stdout",
  async () => {
    const tempDir =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "os-saas-db-quiet-"
        )
      );

    try {
      fs.writeFileSync(
        path.join(
          tempDir,
          ".env"
        ),
        [
          "DB_HOST=127.0.0.1",
          "DB_PORT=5432",
          "DB_USER=fake_user",
          "DB_PASSWORD=fake_password",
          "DB_NAME=fake_database",
          "",
        ].join("\n"),
        "utf8"
      );

      const result =
        await runChild({
          cwd: tempDir,
          dbPath:
            path.resolve(
              __dirname,
              "..",
              "db.js"
            ),
        });

      assert.equal(
        result.exitCode,
        0,
        result.stderr
      );

      assert.equal(
        result.stderr,
        ""
      );

      assert.equal(
        result.stdout,
        "DB_MODULE_OK\n"
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
);
