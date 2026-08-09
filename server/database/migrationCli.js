const {
  createBaselineSchemaVerifier,
} = require("./baselineSchemaVerifier");

const {
  BASELINE_MODE_APPLY_EMPTY,
  BASELINE_MODE_REGISTER_EXISTING,
  createMigrationOrchestrator,
} = require("./migrationOrchestrator");

const {
  createPgDumpSchemaProvider,
} = require("./pgDumpSchemaProvider");

const CLI_USAGE = [
  "Uso:",
  "  node scripts/migrations.js status",
  "  node scripts/migrations.js migrate [--wait-for-lock]",
  "  node scripts/migrations.js baseline register-existing --confirm-baseline=register-existing [--wait-for-lock]",
  "  node scripts/migrations.js baseline apply-empty --confirm-baseline=apply-empty [--wait-for-lock]",
  "",
  "Regras:",
  "  status e somente leitura.",
  "  migrate nunca inicializa baseline automaticamente.",
  "  baseline exige modo e confirmacao explicitos.",
  "  register-existing valida o schema por pg_dump antes de registrar.",
  "  apply-empty exige schema public comprovadamente vazio.",
].join("\n");

const SAFE_ERROR_NAMES =
  new Set([
    "MigrationCliError",
    "MigrationOrchestratorError",
    "BaselineSchemaVerifierError",
    "PgDumpSchemaProviderError",
    "MigrationStoreError",
    "MigrationRunnerError",
    "MigrationCatalogError",
  ]);

class MigrationCliError
  extends Error {
  constructor(
    code,
    message,
    details = {},
    cause = null
  ) {
    super(message);

    this.name =
      "MigrationCliError";

    this.code = code;
    this.details = details;

    if (cause) {
      this.cause = cause;
    }
  }
}

function assertFunction(
  value,
  name
) {
  if (typeof value !== "function") {
    throw new TypeError(
      name + " deve ser uma função."
    );
  }
}

function assertPool(pool) {
  if (
    !pool ||
    typeof pool.connect !== "function" ||
    typeof pool.end !== "function"
  ) {
    throw new TypeError(
      "Um pool PostgreSQL válido é obrigatório para a CLI."
    );
  }
}

function normalizeArgv(argv) {
  if (!Array.isArray(argv)) {
    throw new TypeError(
      "argv deve ser um array."
    );
  }

  return argv.map(
    (value) =>
      String(value)
        .trim()
  );
}

function parseOptionalWaitFlag(
  args
) {
  let waitForLock = false;

  for (const arg of args) {
    if (
      arg ===
      "--wait-for-lock"
    ) {
      if (waitForLock) {
        throw new MigrationCliError(
          "DUPLICATE_CLI_OPTION",
          "A opção --wait-for-lock foi informada mais de uma vez."
        );
      }

      waitForLock = true;

      continue;
    }

    throw new MigrationCliError(
      "UNKNOWN_CLI_OPTION",
      "A CLI recebeu uma opção não reconhecida.",
      {
        option: arg,
      }
    );
  }

  return {
    waitForLock,
  };
}

function parseBaselineOptions(
  mode,
  args
) {
  let waitForLock = false;
  let confirmation = null;

  for (const arg of args) {
    if (
      arg ===
      "--wait-for-lock"
    ) {
      if (waitForLock) {
        throw new MigrationCliError(
          "DUPLICATE_CLI_OPTION",
          "A opção --wait-for-lock foi informada mais de uma vez."
        );
      }

      waitForLock = true;

      continue;
    }

    if (
      arg.startsWith(
        "--confirm-baseline="
      )
    ) {
      if (confirmation !== null) {
        throw new MigrationCliError(
          "DUPLICATE_CLI_OPTION",
          "A confirmação explícita da baseline foi informada mais de uma vez."
        );
      }

      confirmation =
        arg
          .slice(
            "--confirm-baseline="
              .length
          )
          .trim();

      continue;
    }

    throw new MigrationCliError(
      "UNKNOWN_CLI_OPTION",
      "A CLI recebeu uma opção não reconhecida.",
      {
        option: arg,
      }
    );
  }

  if (
    confirmation !== mode
  ) {
    throw new MigrationCliError(
      "BASELINE_CONFIRMATION_REQUIRED",
      "A operação de baseline exige confirmação explícita igual ao modo solicitado.",
      {
        mode,
        expectedConfirmation:
          "--confirm-baseline=" +
          mode,
      }
    );
  }

  return {
    waitForLock,
  };
}

function parseMigrationCliArgs(
  argv
) {
  const args =
    normalizeArgv(
      argv
    );

  if (
    args.length === 0 ||
    args[0] === "--help" ||
    args[0] === "-h" ||
    args[0] === "help"
  ) {
    return Object.freeze({
      action: "help",
    });
  }

  const action =
    args[0];

  if (action === "status") {
    if (args.length !== 1) {
      throw new MigrationCliError(
        "INVALID_CLI_ARGUMENTS",
        "status não aceita argumentos adicionais."
      );
    }

    return Object.freeze({
      action: "status",
    });
  }

  if (action === "migrate") {
    const options =
      parseOptionalWaitFlag(
        args.slice(1)
      );

    return Object.freeze({
      action: "migrate",
      waitForLock:
        options.waitForLock,
    });
  }

  if (action === "baseline") {
    const mode =
      args[1];

    if (
      mode !==
        BASELINE_MODE_REGISTER_EXISTING &&
      mode !==
        BASELINE_MODE_APPLY_EMPTY
    ) {
      throw new MigrationCliError(
        "INVALID_BASELINE_MODE",
        "baseline exige o modo register-existing ou apply-empty.",
        {
          mode:
            mode || null,
        }
      );
    }

    const options =
      parseBaselineOptions(
        mode,
        args.slice(2)
      );

    return Object.freeze({
      action: "baseline",
      mode,
      waitForLock:
        options.waitForLock,
    });
  }

  throw new MigrationCliError(
    "UNKNOWN_CLI_COMMAND",
    "Comando de migrations não reconhecido.",
    {
      command:
        action || null,
    }
  );
}

function sanitizeDetails(
  value,
  depth = 0
) {
  if (depth > 5) {
    return null;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(
      (item) =>
        sanitizeDetails(
          item,
          depth + 1
        )
    );
  }

  if (
    typeof value !== "object"
  ) {
    return null;
  }

  const result = {};

  for (
    const [
      key,
      item,
    ] of Object.entries(value)
  ) {
    if (
      /password|secret|token|database_url|connection|string|sql|dump|filepath|file_path|path/i.test(
        key
      )
    ) {
      continue;
    }

    result[key] =
      sanitizeDetails(
        item,
        depth + 1
      );
  }

  return result;
}

function serializeCliError(
  error
) {
  const safe =
    Boolean(
      error &&
      SAFE_ERROR_NAMES.has(
        error.name
      ) &&
      error.code
    );

  if (!safe) {
    return {
      ok: false,
      error: {
        name:
          "MigrationCliError",
        code:
          "MIGRATION_CLI_UNEXPECTED_ERROR",
        message:
          "Falha inesperada na operação de migrations.",
      },
    };
  }

  const details =
    sanitizeDetails(
      error.details
    );

  const serialized = {
    ok: false,

    error: {
      name:
        error.name,
      code:
        String(
          error.code
        ),
      message:
        String(
          error.message ||
          "Falha na operação de migrations."
        ),
    },
  };

  if (
    details &&
    typeof details ===
      "object" &&
    Object.keys(
      details
    ).length > 0
  ) {
    serialized.error.details =
      details;
  }

  return serialized;
}

function describeCommand(
  command
) {
  if (
    command.action ===
      "baseline"
  ) {
    return {
      action:
        command.action,
      mode:
        command.mode,
      waitForLock:
        command.waitForLock ===
        true,
    };
  }

  if (
    command.action ===
      "migrate"
  ) {
    return {
      action:
        command.action,
      waitForLock:
        command.waitForLock ===
        true,
    };
  }

  return {
    action:
      command.action,
  };
}

function resolveFactories(
  options
) {
  const factories = {
    getPool:
      options.getPool ||
      (() =>
        require("../db")),

    createOrchestrator:
      options.createOrchestrator ||
      createMigrationOrchestrator,

    createVerifier:
      options.createVerifier ||
      createBaselineSchemaVerifier,

    createDumpProvider:
      options.createDumpProvider ||
      createPgDumpSchemaProvider,
  };

  for (
    const [
      name,
      factory,
    ] of Object.entries(
      factories
    )
  ) {
    assertFunction(
      factory,
      name
    );
  }

  return factories;
}

async function executeMigrationCommand(
  command,
  options = {}
) {
  const factories =
    resolveFactories(
      options
    );

  const pool =
    await factories
      .getPool();

  assertPool(pool);

  let operationResult = null;
  let operationError = null;

  try {
    let orchestrator;

    if (
      command.action ===
        "baseline" &&
      command.mode ===
        BASELINE_MODE_REGISTER_EXISTING
    ) {
      const dumpSchema =
        factories
          .createDumpProvider({
            env:
              options.env ||
              process.env,
          });

      assertFunction(
        dumpSchema,
        "dumpSchema"
      );

      const verifier =
        factories
          .createVerifier({
            dumpSchema,
          });

      orchestrator =
        factories
          .createOrchestrator({
            pool,
            baselineVerifier:
              verifier,
          });
    } else {
      orchestrator =
        factories
          .createOrchestrator({
            pool,
          });
    }

    if (
      !orchestrator ||
      typeof orchestrator !==
        "object"
    ) {
      throw new TypeError(
        "A factory do orchestrator retornou valor inválido."
      );
    }

    if (
      command.action ===
      "status"
    ) {
      assertFunction(
        orchestrator.status,
        "orchestrator.status"
      );

      operationResult =
        await orchestrator
          .status();
    } else if (
      command.action ===
      "migrate"
    ) {
      assertFunction(
        orchestrator.migrate,
        "orchestrator.migrate"
      );

      operationResult =
        await orchestrator
          .migrate({
            waitForLock:
              command
                .waitForLock ===
              true,
          });
    } else if (
      command.action ===
      "baseline"
    ) {
      assertFunction(
        orchestrator.baseline,
        "orchestrator.baseline"
      );

      operationResult =
        await orchestrator
          .baseline({
            mode:
              command.mode,
            waitForLock:
              command
                .waitForLock ===
              true,
          });
    } else {
      throw new MigrationCliError(
        "UNSUPPORTED_PARSED_COMMAND",
        "O comando parseado não possui executor."
      );
    }
  } catch (error) {
    operationError = error;
  }

  let closeError = null;

  try {
    await pool.end();
  } catch (error) {
    closeError = error;
  }

  if (closeError) {
    throw new MigrationCliError(
      "MIGRATION_CLI_POOL_CLOSE_FAILED",
      "Não foi possível encerrar o pool PostgreSQL da CLI.",
      {
        operationError:
          operationError
            ? serializeCliError(
                operationError
              ).error
            : null,
        closeError: {
          name:
            closeError.name ||
            "Error",
          code:
            closeError.code ||
            null,
        },
      },
      operationError ||
        closeError
    );
  }

  if (operationError) {
    throw operationError;
  }

  return {
    ok: true,
    command:
      describeCommand(
        command
      ),
    result:
      operationResult,
  };
}

async function runMigrationCli(
  argv,
  options = {}
) {
  const command =
    parseMigrationCliArgs(
      argv
    );

  if (
    command.action ===
    "help"
  ) {
    return {
      ok: true,
      command: {
        action: "help",
      },
      usage:
        CLI_USAGE,
    };
  }

  return (
    executeMigrationCommand(
      command,
      options
    )
  );
}

module.exports = {
  CLI_USAGE,
  MigrationCliError,
  describeCommand,
  executeMigrationCommand,
  parseMigrationCliArgs,
  runMigrationCli,
  sanitizeDetails,
  serializeCliError,
};
