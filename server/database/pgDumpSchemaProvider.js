const {
  spawn,
} = require("node:child_process");

const REQUIRED_PG_DUMP_VERSION =
  Object.freeze({
    major: 18,
    minor: 4,
  });

const PG_DUMP_VERSION_TIMEOUT_MS =
  10_000;

const PG_DUMP_SCHEMA_TIMEOUT_MS =
  120_000;

const PG_DUMP_SCHEMA_ARGS =
  Object.freeze([
    "--schema=public",
    "--schema-only",
    "--format=plain",
    "--encoding=UTF8",
    "--no-owner",
    "--no-privileges",
  ]);

const SYSTEM_ENV_KEYS =
  Object.freeze([
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ]);

class PgDumpSchemaProviderError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    cause = null
  ) {
    super(message);

    this.name =
      "PgDumpSchemaProviderError";

    this.code = code;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }
  }
}

function decodeUrlComponent(
  value
) {
  try {
    return decodeURIComponent(
      String(value || "")
    );
  } catch {
    throw new PgDumpSchemaProviderError(
      "INVALID_DATABASE_URL",
      "DATABASE_URL possui formato inválido."
    );
  }
}

function requireText(
  value,
  fieldName
) {
  const text =
    String(value || "")
      .trim();

  if (!text) {
    throw new PgDumpSchemaProviderError(
      "DATABASE_CONFIGURATION_INCOMPLETE",
      "A configuração de banco para pg_dump está incompleta.",
      {
        missing: [
          fieldName,
        ],
      }
    );
  }

  return text;
}

function resolveUrlConnectionEnvironment(
  databaseUrl
) {
  let parsed;

  try {
    parsed =
      new URL(databaseUrl);
  } catch {
    throw new PgDumpSchemaProviderError(
      "INVALID_DATABASE_URL",
      "DATABASE_URL possui formato inválido."
    );
  }

  if (
    parsed.protocol !==
      "postgres:" &&
    parsed.protocol !==
      "postgresql:"
  ) {
    throw new PgDumpSchemaProviderError(
      "INVALID_DATABASE_URL",
      "DATABASE_URL não utiliza um protocolo PostgreSQL suportado."
    );
  }

  const host =
    requireText(
      parsed.hostname,
      "DATABASE_URL.host"
    );

  if (
    /pooler/i.test(host)
  ) {
    throw new PgDumpSchemaProviderError(
      "PG_DUMP_POOLER_FORBIDDEN",
      "register-existing exige uma conexão PostgreSQL direta, não um endpoint pooler."
    );
  }

  const user =
    requireText(
      decodeUrlComponent(
        parsed.username
      ),
      "DATABASE_URL.user"
    );

  const password =
    requireText(
      decodeUrlComponent(
        parsed.password
      ),
      "DATABASE_URL.password"
    );

  const database =
    requireText(
      decodeUrlComponent(
        parsed.pathname
          .replace(/^\/+/, "")
      ),
      "DATABASE_URL.database"
    );

  return {
    PGHOST: host,
    PGPORT:
      parsed.port || "5432",
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: database,
    PGSSLMODE: "require",
    PGCHANNELBINDING:
      "require",
    PGCLIENTENCODING: "UTF8",
    PGCONNECT_TIMEOUT: "10",
  };
}

function resolveLocalConnectionEnvironment(
  sourceEnv
) {
  const required = [
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_NAME",
  ];

  const missing =
    required.filter(
      (key) =>
        !String(
          sourceEnv[key] || ""
        ).trim()
    );

  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        sourceEnv,
        "DB_PASSWORD"
      )
  ) {
    missing.push(
      "DB_PASSWORD"
    );
  }

  if (missing.length > 0) {
    throw new PgDumpSchemaProviderError(
      "DATABASE_CONFIGURATION_INCOMPLETE",
      "A configuração de banco para pg_dump está incompleta.",
      {
        missing,
      }
    );
  }

  return {
    PGHOST:
      String(
        sourceEnv.DB_HOST
      ).trim(),
    PGPORT:
      String(
        sourceEnv.DB_PORT
      ).trim(),
    PGUSER:
      String(
        sourceEnv.DB_USER
      ).trim(),
    PGPASSWORD:
      String(
        sourceEnv.DB_PASSWORD
      ),
    PGDATABASE:
      String(
        sourceEnv.DB_NAME
      ).trim(),
    PGCLIENTENCODING: "UTF8",
    PGCONNECT_TIMEOUT: "10",
  };
}

function resolveDatabaseConnectionEnvironment(
  sourceEnv = process.env
) {
  if (
    !sourceEnv ||
    typeof sourceEnv !==
      "object"
  ) {
    throw new TypeError(
      "Um objeto de ambiente válido é obrigatório."
    );
  }

  const databaseUrl =
    String(
      sourceEnv.DATABASE_URL ||
      ""
    ).trim();

  if (databaseUrl) {
    return (
      resolveUrlConnectionEnvironment(
        databaseUrl
      )
    );
  }

  return (
    resolveLocalConnectionEnvironment(
      sourceEnv
    )
  );
}

function buildSystemChildEnvironment(
  sourceEnv = process.env
) {
  const result = {};

  for (
    const key of SYSTEM_ENV_KEYS
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          sourceEnv,
          key
        ) &&
      sourceEnv[key] !==
        undefined
    ) {
      result[key] =
        String(
          sourceEnv[key]
        );
    }
  }

  return result;
}

function buildPgDumpChildEnvironment(
  sourceEnv,
  connectionEnvironment
) {
  return {
    ...buildSystemChildEnvironment(
      sourceEnv
    ),
    ...connectionEnvironment,
  };
}

function parsePgDumpVersion(
  stdout
) {
  const text =
    String(stdout || "")
      .trim();

  const match =
    text.match(
      /pg_dump\s+\(PostgreSQL\)\s+(\d+)(?:\.(\d+))?/i
    );

  if (!match) {
    throw new PgDumpSchemaProviderError(
      "PG_DUMP_VERSION_UNRECOGNIZED",
      "Não foi possível identificar a versão do pg_dump."
    );
  }

  return {
    major:
      Number(match[1]),
    minor:
      match[2] ===
        undefined
        ? null
        : Number(
            match[2]
          ),
    text,
  };
}

function runProcess(
  command,
  args,
  options = {}
) {
  const maxStdoutBytes =
    Number.isInteger(
      options.maxStdoutBytes
    ) &&
    options.maxStdoutBytes > 0
      ? options.maxStdoutBytes
      : 20 * 1024 * 1024;

  const maxStderrBytes =
    Number.isInteger(
      options.maxStderrBytes
    ) &&
    options.maxStderrBytes > 0
      ? options.maxStderrBytes
      : 256 * 1024;

  const timeoutMs =
    Number.isInteger(
      options.timeoutMs
    ) &&
    options.timeoutMs > 0
      ? options.timeoutMs
      : PG_DUMP_SCHEMA_TIMEOUT_MS;

  return new Promise(
    (resolve, reject) => {
      let child;
      let settled = false;
      let timeoutHandle = null;

      const stdoutChunks = [];
      const stderrChunks = [];

      let stdoutBytes = 0;
      let stderrBytes = 0;

      function clearTimer() {
        if (timeoutHandle) {
          clearTimeout(
            timeoutHandle
          );

          timeoutHandle = null;
        }
      }

      function terminateChild() {
        if (
          child &&
          child.killed !== true
        ) {
          try {
            child.kill();
          } catch {
            // Cleanup best-effort.
          }
        }
      }

      function fail(
        error,
        shouldTerminate
      ) {
        if (settled) {
          return;
        }

        settled = true;
        clearTimer();

        if (shouldTerminate) {
          terminateChild();
        }

        reject(error);
      }

      function consume(
        stream,
        chunks,
        label,
        maxBytes,
        addBytes
      ) {
        if (!stream) {
          return;
        }

        stream.on(
          "data",
          (chunk) => {
            if (settled) {
              return;
            }

            const buffer =
              Buffer.isBuffer(
                chunk
              )
                ? chunk
                : Buffer.from(
                    chunk
                  );

            const total =
              addBytes(
                buffer.length
              );

            if (
              total >
              maxBytes
            ) {
              chunks.length = 0;

              fail(
                new PgDumpSchemaProviderError(
                  "PG_DUMP_OUTPUT_LIMIT_EXCEEDED",
                  "A saída " +
                    label +
                    " do pg_dump excedeu o limite operacional."
                ),
                true
              );

              return;
            }

            chunks.push(
              buffer
            );
          }
        );

        stream.on(
          "error",
          (error) => {
            fail(
              error,
              true
            );
          }
        );
      }

      try {
        child = spawn(
          command,
          args,
          {
            env:
              options.env,
            shell: false,
            windowsHide: true,
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          }
        );
      } catch (error) {
        fail(
          error,
          false
        );

        return;
      }

      consume(
        child.stdout,
        stdoutChunks,
        "stdout",
        maxStdoutBytes,
        (size) => {
          stdoutBytes += size;

          return stdoutBytes;
        }
      );

      consume(
        child.stderr,
        stderrChunks,
        "stderr",
        maxStderrBytes,
        (size) => {
          stderrBytes += size;

          return stderrBytes;
        }
      );

      child.once(
        "error",
        (error) => {
          fail(
            error,
            false
          );
        }
      );

      child.once(
        "close",
        (
          exitCode,
          signal
        ) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimer();

          resolve({
            exitCode,
            signal:
              signal || null,
            stdout:
              Buffer
                .concat(
                  stdoutChunks
                )
                .toString(
                  "utf8"
                ),
            stderr:
              Buffer
                .concat(
                  stderrChunks
                )
                .toString(
                  "utf8"
                ),
          });
        }
      );

      timeoutHandle =
        setTimeout(
          () => {
            fail(
              new PgDumpSchemaProviderError(
                "PG_DUMP_PROCESS_TIMEOUT",
                "O pg_dump excedeu o tempo máximo permitido.",
                {
                  timeoutMs,
                }
              ),
              true
            );
          },
          timeoutMs
        );
    }
  );
}

function assertProcessSucceeded(
  result,
  code,
  message
) {
  if (
    !result ||
    result.exitCode !== 0
  ) {
    throw new PgDumpSchemaProviderError(
      code,
      message,
      {
        exitCode:
          result &&
          Number.isInteger(
            result.exitCode
          )
            ? result.exitCode
            : null,
        signal:
          result &&
          result.signal
            ? String(
                result.signal
              )
            : null,
      }
    );
  }
}

function createPgDumpSchemaProvider(
  options = {}
) {
  const sourceEnv =
    options.env ||
    process.env;

  const processRunner =
    options.runProcess ||
    runProcess;

  const pgDumpCommand =
    options.pgDumpCommand ||
    "pg_dump";

  const requiredVersion =
    options.requiredVersion &&
    Number.isInteger(
      options.requiredVersion
        .major
    ) &&
    Number.isInteger(
      options.requiredVersion
        .minor
    )
      ? {
          major:
            options
              .requiredVersion
              .major,
          minor:
            options
              .requiredVersion
              .minor,
        }
      : {
          ...REQUIRED_PG_DUMP_VERSION,
        };

  if (
    typeof processRunner !==
      "function"
  ) {
    throw new TypeError(
      "runProcess deve ser uma função."
    );
  }

  return async function dumpSchema() {
    const connectionEnvironment =
      resolveDatabaseConnectionEnvironment(
        sourceEnv
      );

    const systemEnvironment =
      buildSystemChildEnvironment(
        sourceEnv
      );

    let versionResult;

    try {
      versionResult =
        await processRunner(
          pgDumpCommand,
          [
            "--version",
          ],
          {
            env:
              systemEnvironment,
            maxStdoutBytes:
              64 * 1024,
            maxStderrBytes:
              64 * 1024,
            timeoutMs:
              PG_DUMP_VERSION_TIMEOUT_MS,
          }
        );
    } catch (error) {
      throw new PgDumpSchemaProviderError(
        "PG_DUMP_EXECUTION_FAILED",
        "Não foi possível executar o pg_dump.",
        {
          causeCode:
            error &&
            error.code
              ? String(
                  error.code
                )
              : null,
        }
      );
    }

    assertProcessSucceeded(
      versionResult,
      "PG_DUMP_VERSION_FAILED",
      "A verificação da versão do pg_dump falhou."
    );

    const version =
      parsePgDumpVersion(
        versionResult.stdout
      );

    if (
      version.major !==
        requiredVersion.major ||
      version.minor !==
        requiredVersion.minor
    ) {
      throw new PgDumpSchemaProviderError(
        "PG_DUMP_VERSION_MISMATCH",
        "A versão do pg_dump não corresponde à versão usada para gerar o fingerprint canônico da baseline.",
        {
          requiredVersion:
            String(
              requiredVersion.major
            ) +
            "." +
            String(
              requiredVersion.minor
            ),
          actualVersion:
            version.minor === null
              ? String(
                  version.major
                )
              : String(
                  version.major
                ) +
                "." +
                String(
                  version.minor
                ),
        }
      );
    }

    const childEnvironment =
      buildPgDumpChildEnvironment(
        sourceEnv,
        connectionEnvironment
      );

    let dumpResult;

    try {
      dumpResult =
        await processRunner(
          pgDumpCommand,
          [
            ...PG_DUMP_SCHEMA_ARGS,
          ],
          {
            env:
              childEnvironment,
            maxStdoutBytes:
              20 * 1024 * 1024,
            maxStderrBytes:
              256 * 1024,
            timeoutMs:
              PG_DUMP_SCHEMA_TIMEOUT_MS,
          }
        );
    } catch (error) {
      throw new PgDumpSchemaProviderError(
        "PG_DUMP_EXECUTION_FAILED",
        "Não foi possível executar o pg_dump.",
        {
          causeCode:
            error &&
            error.code
              ? String(
                  error.code
                )
              : null,
        }
      );
    }

    assertProcessSucceeded(
      dumpResult,
      "PG_DUMP_SCHEMA_FAILED",
      "O pg_dump não conseguiu exportar o schema public."
    );

    const dumpSql =
      String(
        dumpResult.stdout ||
        ""
      );

    if (
      !dumpSql.trim()
    ) {
      throw new PgDumpSchemaProviderError(
        "PG_DUMP_EMPTY_SCHEMA_OUTPUT",
        "O pg_dump retornou um dump estrutural vazio."
      );
    }

    return dumpSql;
  };
}

module.exports = {
  PG_DUMP_SCHEMA_ARGS,
  PG_DUMP_SCHEMA_TIMEOUT_MS,
  PG_DUMP_VERSION_TIMEOUT_MS,
  REQUIRED_PG_DUMP_VERSION,
  SYSTEM_ENV_KEYS,
  PgDumpSchemaProviderError,
  buildPgDumpChildEnvironment,
  buildSystemChildEnvironment,
  createPgDumpSchemaProvider,
  parsePgDumpVersion,
  resolveDatabaseConnectionEnvironment,
  runProcess,
};
