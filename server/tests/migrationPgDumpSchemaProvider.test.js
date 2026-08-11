const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PG_DUMP_SCHEMA_ARGS,
  PgDumpSchemaProviderError,
  buildPgDumpChildEnvironment,
  buildSystemChildEnvironment,
  createPgDumpSchemaProvider,
  parsePgDumpVersion,
  resolveDatabaseConnectionEnvironment,
  runProcess,
} = require(
  "../database/pgDumpSchemaProvider"
);

test(
  "resolveDatabaseConnectionEnvironment converte DATABASE_URL sem expor a URL ao filho",
  () => {
    const sourceEnv = {
      DATABASE_URL:
        "postgresql://user%40example:p%40ss%3Aword@ep-example.us-east-1.aws.neon.tech:5432/os_saas?sslmode=require&channel_binding=require",
    };

    const result =
      resolveDatabaseConnectionEnvironment(
        sourceEnv
      );

    assert.deepEqual(
      result,
      {
        PGHOST:
          "ep-example.us-east-1.aws.neon.tech",
        PGPORT:
          "5432",
        PGUSER:
          "user@example",
        PGPASSWORD:
          "p@ss:word",
        PGDATABASE:
          "os_saas",
        PGSSLMODE:
          "require",
        PGCHANNELBINDING:
          "require",
        PGCLIENTENCODING:
          "UTF8",
        PGCONNECT_TIMEOUT:
          "10",
      }
    );

    assert.equal(
      Object.values(
        result
      ).includes(
        sourceEnv.DATABASE_URL
      ),
      false
    );
  }
);

test(
  "resolveDatabaseConnectionEnvironment rejeita endpoint pooler",
  () => {
    const secret =
      "SUPER_SECRET_PASSWORD";

    assert.throws(
      () =>
        resolveDatabaseConnectionEnvironment({
          DATABASE_URL:
            `postgresql://user:${secret}@ep-example-pooler.aws.neon.tech/os_saas`,
        }),
      (error) => {
        assert.ok(
          error instanceof
            PgDumpSchemaProviderError
        );

        assert.equal(
          error.code,
          "PG_DUMP_POOLER_FORBIDDEN"
        );

        const visible =
          [
            error.message,
            JSON.stringify(
              error.details
            ),
          ].join(" ");

        assert.equal(
          visible.includes(
            secret
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "resolveDatabaseConnectionEnvironment usa configuracao local do mesmo ambiente do db.js",
  () => {
    const result =
      resolveDatabaseConnectionEnvironment({
        DB_HOST:
          "127.0.0.1",
        DB_PORT:
          "5432",
        DB_USER:
          "os",
        DB_PASSWORD:
          "local-secret",
        DB_NAME:
          "os_saas",
      });

    assert.deepEqual(
      result,
      {
        PGHOST:
          "127.0.0.1",
        PGPORT:
          "5432",
        PGUSER:
          "os",
        PGPASSWORD:
          "local-secret",
        PGDATABASE:
          "os_saas",
        PGCLIENTENCODING:
          "UTF8",
        PGCONNECT_TIMEOUT:
          "10",
      }
    );
  }
);

test(
  "resolveDatabaseConnectionEnvironment falha fechado quando configuracao local esta incompleta",
  () => {
    assert.throws(
      () =>
        resolveDatabaseConnectionEnvironment({
          DB_HOST:
            "localhost",
        }),
      (error) => {
        assert.equal(
          error.code,
          "DATABASE_CONFIGURATION_INCOMPLETE"
        );

        assert.deepEqual(
          error.details.missing,
          [
            "DB_PORT",
            "DB_USER",
            "DB_NAME",
            "DB_PASSWORD",
          ]
        );

        return true;
      }
    );
  }
);

test(
  "resolveDatabaseConnectionEnvironment nao permite downgrade de TLS pela DATABASE_URL",
  () => {
    const result =
      resolveDatabaseConnectionEnvironment({
        DATABASE_URL:
          "postgresql://os:secret@db.example.com/os_saas?sslmode=disable&channel_binding=disable",
      });

    assert.equal(
      result.PGSSLMODE,
      "require"
    );

    assert.equal(
      result.PGCHANNELBINDING,
      "require"
    );
  }
);

test(
  "buildSystemChildEnvironment nao herda segredos da aplicacao",
  () => {
    const result =
      buildSystemChildEnvironment({
        Path:
          "C:\\Windows\\System32",
        SystemRoot:
          "C:\\Windows",
        TEMP:
          "C:\\Temp",
        DATABASE_URL:
          "SUPER_SECRET_URL",
        DB_PASSWORD:
          "SUPER_SECRET_DB",
        JWT_SECRET:
          "SUPER_SECRET_JWT",
      });

    assert.deepEqual(
      result,
      {
        Path:
          "C:\\Windows\\System32",
        SystemRoot:
          "C:\\Windows",
        TEMP:
          "C:\\Temp",
      }
    );
  }
);

test(
  "buildPgDumpChildEnvironment adiciona apenas variaveis PostgreSQL controladas",
  () => {
    const result =
      buildPgDumpChildEnvironment(
        {
          PATH:
            "/usr/bin",
          JWT_SECRET:
            "nao-herdar",
        },
        {
          PGHOST:
            "localhost",
          PGUSER:
            "os",
          PGPASSWORD:
            "secret",
        }
      );

    assert.deepEqual(
      result,
      {
        PATH:
          "/usr/bin",
        PGHOST:
          "localhost",
        PGUSER:
          "os",
        PGPASSWORD:
          "secret",
      }
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          result,
          "JWT_SECRET"
        ),
      false
    );
  }
);

test(
  "parsePgDumpVersion reconhece PostgreSQL 18.4",
  () => {
    assert.deepEqual(
      parsePgDumpVersion(
        "pg_dump (PostgreSQL) 18.4"
      ),
      {
        major: 18,
        minor: 4,
        text:
          "pg_dump (PostgreSQL) 18.4",
      }
    );
  }
);

test(
  "parsePgDumpVersion rejeita saida desconhecida",
  () => {
    assert.throws(
      () =>
        parsePgDumpVersion(
          "ferramenta desconhecida"
        ),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_VERSION_UNRECOGNIZED"
        );

        return true;
      }
    );
  }
);

test(
  "createPgDumpSchemaProvider usa flags historicas e nunca coloca senha nos argumentos",
  async () => {
    const secret =
      "ULTRA_SECRET_PASSWORD";

    const calls = [];

    const provider =
      createPgDumpSchemaProvider({
        env: {
          PATH:
            "/usr/bin",
          DATABASE_URL:
            `postgresql://os:${secret}@db.example.com/os_saas?sslmode=require&channel_binding=require`,
          JWT_SECRET:
            "JWT_SHOULD_NOT_LEAK",
        },

        async runProcess(
          command,
          args,
          options
        ) {
          calls.push({
            command,
            args:
              [
                ...args,
              ],
            env: {
              ...options.env,
            },
            timeoutMs:
              options.timeoutMs,
          });

          if (
            args[0] ===
            "--version"
          ) {
            return {
              exitCode: 0,
              signal: null,
              stdout:
                "pg_dump (PostgreSQL) 18.4\n",
              stderr: "",
            };
          }

          return {
            exitCode: 0,
            signal: null,
            stdout:
              "CREATE TABLE public.example (id integer);\n",
            stderr: "",
          };
        },
      });

    const dump =
      await provider();

    assert.equal(
      dump,
      "CREATE TABLE public.example (id integer);\n"
    );

    assert.equal(
      calls.length,
      2
    );

    assert.deepEqual(
      calls[1].args,
      [
        ...PG_DUMP_SCHEMA_ARGS,
      ]
    );

    const allArguments =
      calls
        .flatMap(
          (call) =>
            call.args
        )
        .join(" ");

    assert.equal(
      allArguments.includes(
        secret
      ),
      false
    );

    assert.equal(
      calls[0].env.PGPASSWORD,
      undefined
    );

    assert.equal(
      calls[1].env.PGPASSWORD,
      secret
    );

    assert.equal(
      calls[1].env.JWT_SECRET,
      undefined
    );

    assert.equal(
      calls[1].env.DATABASE_URL,
      undefined
    );

    assert.equal(
      calls[0].timeoutMs,
      10_000
    );

    assert.equal(
      calls[1].timeoutMs,
      120_000
    );
  }
);

test(
  "createPgDumpSchemaProvider exige exatamente pg_dump 18.4 antes do dump",
  async () => {
    let calls = 0;

    const provider =
      createPgDumpSchemaProvider({
        env: {
          DB_HOST:
            "localhost",
          DB_PORT:
            "5432",
          DB_USER:
            "os",
          DB_PASSWORD:
            "secret",
          DB_NAME:
            "os_saas",
        },

        async runProcess() {
          calls += 1;

          return {
            exitCode: 0,
            signal: null,
            stdout:
              "pg_dump (PostgreSQL) 18.5\n",
            stderr: "",
          };
        },
      });

    await assert.rejects(
      () =>
        provider(),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_VERSION_MISMATCH"
        );

        assert.deepEqual(
          error.details,
          {
            requiredVersion:
              "18.4",
            actualVersion:
              "18.5",
          }
        );

        return true;
      }
    );

    assert.equal(
      calls,
      1
    );
  }
);

test(
  "createPgDumpSchemaProvider nao inclui stderr potencialmente sensivel no erro",
  async () => {
    const secret =
      "SERVER_ERROR_SECRET";

    let calls = 0;

    const provider =
      createPgDumpSchemaProvider({
        env: {
          DB_HOST:
            "localhost",
          DB_PORT:
            "5432",
          DB_USER:
            "os",
          DB_PASSWORD:
            "secret",
          DB_NAME:
            "os_saas",
        },

        async runProcess(
          command,
          args
        ) {
          calls += 1;

          if (
            args[0] ===
            "--version"
          ) {
            return {
              exitCode: 0,
              signal: null,
              stdout:
                "pg_dump (PostgreSQL) 18.4\n",
              stderr: "",
            };
          }

          return {
            exitCode: 2,
            signal: null,
            stdout: "",
            stderr:
              `connection failed ${secret}`,
          };
        },
      });

    await assert.rejects(
      () =>
        provider(),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_SCHEMA_FAILED"
        );

        const visible =
          [
            error.message,
            JSON.stringify(
              error.details
            ),
          ].join(" ");

        assert.equal(
          visible.includes(
            secret
          ),
          false
        );

        return true;
      }
    );

    assert.equal(
      calls,
      2
    );
  }
);

test(
  "createPgDumpSchemaProvider rejeita dump vazio",
  async () => {
    const provider =
      createPgDumpSchemaProvider({
        env: {
          DB_HOST:
            "localhost",
          DB_PORT:
            "5432",
          DB_USER:
            "os",
          DB_PASSWORD:
            "secret",
          DB_NAME:
            "os_saas",
        },

        async runProcess(
          command,
          args
        ) {
          if (
            args[0] ===
            "--version"
          ) {
            return {
              exitCode: 0,
              signal: null,
              stdout:
                "pg_dump (PostgreSQL) 18.4\n",
              stderr: "",
            };
          }

          return {
            exitCode: 0,
            signal: null,
            stdout:
              "   \n",
            stderr: "",
          };
        },
      });

    await assert.rejects(
      () =>
        provider(),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_EMPTY_SCHEMA_OUTPUT"
        );

        return true;
      }
    );
  }
);

test(
  "createPgDumpSchemaProvider encapsula falha de execucao sem vazar detalhes",
  async () => {
    const secret =
      "PROCESS_SECRET";

    const provider =
      createPgDumpSchemaProvider({
        env: {
          DB_HOST:
            "localhost",
          DB_PORT:
            "5432",
          DB_USER:
            "os",
          DB_PASSWORD:
            secret,
          DB_NAME:
            "os_saas",
        },

        async runProcess() {
          const error =
            new Error(
              `spawn failed ${secret}`
            );

          error.code =
            "ENOENT";

          throw error;
        },
      });

    await assert.rejects(
      () =>
        provider(),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_EXECUTION_FAILED"
        );

        assert.equal(
          error.details
            .causeCode,
          "ENOENT"
        );

        const visible =
          [
            error.message,
            JSON.stringify(
              error.details
            ),
          ].join(" ");

        assert.equal(
          visible.includes(
            secret
          ),
          false
        );

        return true;
      }
    );
  }
);

test(
  "runProcess interrompe subprocesso que excede timeout",
  async () => {
    await assert.rejects(
      () =>
        runProcess(
          process.execPath,
          [
            "-e",
            "setTimeout(() => {}, 5000);",
          ],
          {
            env:
              process.env,
            timeoutMs: 100,
            maxStdoutBytes:
              64 * 1024,
            maxStderrBytes:
              64 * 1024,
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_PROCESS_TIMEOUT"
        );

        assert.equal(
          error.details
            .timeoutMs,
          100
        );

        return true;
      }
    );
  }
);

test(
  "runProcess interrompe subprocesso quando stdout excede limite",
  async () => {
    await assert.rejects(
      () =>
        runProcess(
          process.execPath,
          [
            "-e",
            "process.stdout.write('x'.repeat(4096));",
          ],
          {
            env:
              process.env,
            timeoutMs: 5000,
            maxStdoutBytes: 64,
            maxStderrBytes:
              64 * 1024,
          }
        ),
      (error) => {
        assert.equal(
          error.code,
          "PG_DUMP_OUTPUT_LIMIT_EXCEEDED"
        );

        return true;
      }
    );
  }
);
