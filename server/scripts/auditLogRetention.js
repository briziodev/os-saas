const {
  ACTION_ALL,
  MODE_APPLY,
  MODE_DRY_RUN,
  normalizeAuditAction,
  normalizeRetentionDays,
  normalizeRetentionMode,
  runAuditLogRetention,
} = require("../services/auditLogRetention");

class AuditLogRetentionCliError extends Error {
  constructor(code, message, details = {}) {
    super(message);

    this.name =
      "AuditLogRetentionCliError";

    this.code = code;
    this.details = details;
  }
}

function readArgumentValue(
  argv,
  index,
  argumentName
) {
  const value =
    argv[index + 1];

  if (
    value === undefined ||
    String(value).startsWith("--")
  ) {
    throw new AuditLogRetentionCliError(
      "ARGUMENT_VALUE_REQUIRED",
      `O argumento ${argumentName} exige um valor.`,
      {
        argument:
          argumentName,
      }
    );
  }

  return value;
}

function parsePositiveInteger(
  value,
  argumentName
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed <= 0
  ) {
    throw new AuditLogRetentionCliError(
      "INVALID_POSITIVE_INTEGER",
      `${argumentName} deve ser um inteiro positivo.`,
      {
        argument:
          argumentName,
      }
    );
  }

  return parsed;
}

function parseAuditLogRetentionCliArgs(
  argv = []
) {
  const args =
    Array.isArray(argv)
      ? argv
      : [];

  if (args.length === 0) {
    return {
      help: true,
      retentionDays:
        undefined,
    };
  }

  const parsed = {
    help: false,
    mode: MODE_DRY_RUN,
    retentionDays:
      undefined,
    action: ACTION_ALL,
    confirmation:
      undefined,
    batchSize:
      undefined,
    maxDeletePerRun:
      undefined,
  };

  let actionExplicit = false;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      String(args[index]);

    if (
      argument === "--help" ||
      argument === "-h"
    ) {
      return {
        help: true,
        retentionDays:
          undefined,
      };
    }

    if (
      argument ===
      "--retention-days"
    ) {
      const value =
        readArgumentValue(
          args,
          index,
          argument
        );

      parsed.retentionDays =
        normalizeRetentionDays(
          value
        );

      index += 1;
      continue;
    }

    if (
      argument === "--mode"
    ) {
      const value =
        readArgumentValue(
          args,
          index,
          argument
        );

      parsed.mode =
        normalizeRetentionMode(
          value
        );

      index += 1;
      continue;
    }

    if (
      argument === "--action"
    ) {
      const value =
        readArgumentValue(
          args,
          index,
          argument
        );

      parsed.action =
        normalizeAuditAction(
          value
        );

      actionExplicit = true;

      index += 1;
      continue;
    }

    if (
      argument === "--confirm"
    ) {
      parsed.confirmation =
        String(
          readArgumentValue(
            args,
            index,
            argument
          )
        ).trim();

      index += 1;
      continue;
    }

    if (
      argument === "--batch-size"
    ) {
      parsed.batchSize =
        parsePositiveInteger(
          readArgumentValue(
            args,
            index,
            argument
          ),
          argument
        );

      index += 1;
      continue;
    }

    if (
      argument === "--max-delete"
    ) {
      parsed.maxDeletePerRun =
        parsePositiveInteger(
          readArgumentValue(
            args,
            index,
            argument
          ),
          argument
        );

      index += 1;
      continue;
    }

    throw new AuditLogRetentionCliError(
      "UNKNOWN_ARGUMENT",
      `Argumento desconhecido: ${argument}`,
      {
        argument,
      }
    );
  }

  if (
    parsed.retentionDays ===
    undefined
  ) {
    throw new AuditLogRetentionCliError(
      "RETENTION_DAYS_REQUIRED",
      "--retention-days é obrigatório."
    );
  }

  if (
    parsed.mode === MODE_APPLY
  ) {
    if (!actionExplicit) {
      throw new AuditLogRetentionCliError(
        "APPLY_ACTION_REQUIRED",
        "APPLY exige --action explícito."
      );
    }

    if (
      !parsed.confirmation
    ) {
      throw new AuditLogRetentionCliError(
        "APPLY_CONFIRMATION_REQUIRED",
        "APPLY exige --confirm explícito."
      );
    }
  }

  return parsed;
}

async function createDefaultPool() {
  /*
   * Require tardio proposital.
   *
   * --help e erros de parsing
   * não devem carregar db.js nem
   * abrir qualquer conexão.
   */
  return require("../db");
}

async function closePoolSafely(
  pool
) {
  if (
    !pool ||
    typeof pool.end !== "function"
  ) {
    return;
  }

  await pool.end();
}

async function runAuditLogRetentionCli({
  argv = [],
  createPool =
    createDefaultPool,
  runRetention =
    runAuditLogRetention,
} = {}) {
  const options =
    parseAuditLogRetentionCliArgs(
      argv
    );

  if (options.help) {
    return {
      help: true,
    };
  }

  let pool = null;
  let operationResult;
  let operationError = null;
  let cleanupError = null;

  try {
    pool =
      await createPool();

    operationResult =
      await runRetention(
        pool,
        {
          retentionDays:
            options.retentionDays,
          action:
            options.action,
          mode:
            options.mode,
          confirmation:
            options.confirmation,
          batchSize:
            options.batchSize,
          maxDeletePerRun:
            options.maxDeletePerRun,
        }
      );
  } catch (error) {
    operationError = error;
  }

  try {
    await closePoolSafely(
      pool
    );
  } catch (error) {
    cleanupError = error;
  }

  /*
   * Preserva o erro operacional
   * original se a retenção falhou.
   *
   * Uma eventual falha posterior
   * ao fechar o pool não deve
   * esconder a causa primária.
   */
  if (operationError) {
    throw operationError;
  }

  if (cleanupError) {
    throw new AuditLogRetentionCliError(
      "POOL_CLOSE_FAILED",
      "Falha ao encerrar o pool PostgreSQL."
    );
  }

  return operationResult;
}

function buildUsage() {
  return [
    "Audit Log Retention",
    "",
    "DRY_RUN:",
    "  node scripts/auditLogRetention.js --retention-days <dias> [--action <ACTION>]",
    "",
    "APPLY:",
    "  node scripts/auditLogRetention.js --retention-days <dias> --mode APPLY --action <ACTION|ALL> --confirm <CONFIRMACAO>",
    "",
    "Opções:",
    "  --retention-days <dias>",
    "  --mode <DRY_RUN|APPLY>",
    "  --action <ACTION|ALL>",
    "  --confirm <texto>",
    "  --batch-size <quantidade>",
    "  --max-delete <quantidade>",
    "  --help",
    "",
    "DRY_RUN é o modo padrão.",
    "APPLY nunca assume action implicitamente.",
  ].join("\n");
}

function serializeCliError(
  error
) {
  if (
    error &&
    (
      error.name ===
        "AuditLogRetentionCliError" ||
      error.name ===
        "AuditLogRetentionError"
    )
  ) {
    return {
      name:
        error.name,
      code:
        error.code,
      message:
        error.message,
    };
  }

  return {
    name: "Error",
    code:
      "AUDIT_RETENTION_CLI_FAILED",
    message:
      "Falha inesperada ao executar retenção de auditoria.",
  };
}

async function main() {
  try {
    const result =
      await runAuditLogRetentionCli({
        argv:
          process.argv.slice(2),
      });

    if (result.help) {
      process.stdout.write(
        `${buildUsage()}\n`
      );

      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        result,
      })}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error:
          serializeCliError(
            error
          ),
      })}\n`
    );

    process.exitCode = 1;
  }
}

if (
  require.main === module
) {
  main();
}

module.exports = {
  AuditLogRetentionCliError,
  buildUsage,
  parseAuditLogRetentionCliArgs,
  runAuditLogRetentionCli,
  serializeCliError,
};