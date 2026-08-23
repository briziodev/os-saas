function createDatabaseConfigError(
  code,
  message
) {
  const error =
    new Error(message);

  error.code = code;

  return error;
}

function isLocalDatabaseHost(
  hostname
) {
  const normalized =
    String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\[/, "")
      .replace(/\]$/, "");

  return (
    normalized ===
      "localhost" ||
    normalized ===
      "127.0.0.1" ||
    normalized ===
      "::1"
  );
}

function hardenRemoteDatabaseUrl(
  databaseUrl
) {
  let parsed;

  try {
    parsed =
      new URL(databaseUrl);
  } catch {
    throw createDatabaseConfigError(
      "INVALID_DATABASE_URL",
      "DATABASE_URL possui formato invalido."
    );
  }

  if (
    parsed.protocol !==
      "postgres:" &&
    parsed.protocol !==
      "postgresql:"
  ) {
    throw createDatabaseConfigError(
      "INVALID_DATABASE_URL",
      "DATABASE_URL nao utiliza protocolo PostgreSQL suportado."
    );
  }

  if (
    isLocalDatabaseHost(
      parsed.hostname
    )
  ) {
    return databaseUrl;
  }

  /*
   * O pg-connection-string permite
   * configuracoes TLS na propria URL.
   *
   * Removemos o parametro legado
   * "ssl", pois valores como
   * ssl=no-verify poderiam conflitar
   * com a politica definida abaixo.
   */
  parsed.searchParams.delete(
    "ssl"
  );

  /*
   * Politica para banco remoto:
   * - TLS obrigatorio;
   * - CA validada;
   * - hostname validado;
   * - falha fechada em erro TLS.
   */
  parsed.searchParams.set(
    "sslmode",
    "verify-full"
  );

  return parsed.toString();
}

function buildDatabasePoolConfig(
  sourceEnv = process.env
) {
  const databaseUrl =
    String(
      sourceEnv.DATABASE_URL ||
        ""
    ).trim();

  if (databaseUrl) {
    return {
      connectionString:
        hardenRemoteDatabaseUrl(
          databaseUrl
        ),
    };
  }

  return {
    host:
      sourceEnv.DB_HOST,
    port:
      Number(
        sourceEnv.DB_PORT
      ),
    user:
      sourceEnv.DB_USER,
    password:
      sourceEnv.DB_PASSWORD,
    database:
      sourceEnv.DB_NAME,
  };
}

module.exports = {
  buildDatabasePoolConfig,
};
