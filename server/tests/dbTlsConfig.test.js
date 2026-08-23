const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("pg");

const {
  buildDatabasePoolConfig,
} = require("../dbConfig");

test(
  "DATABASE_URL remota força sslmode=verify-full",
  () => {
    const config =
      buildDatabasePoolConfig({
        DATABASE_URL:
          "postgresql://user:pass@db.example.com/os_saas?sslmode=require&channel_binding=require",
      });

    const parsed =
      new URL(
        config.connectionString
      );

    assert.equal(
      parsed.searchParams.get(
        "sslmode"
      ),
      "verify-full"
    );

    assert.equal(
      parsed.searchParams.get(
        "channel_binding"
      ),
      "require"
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        config,
        "ssl"
      ),
      false
    );

    const client =
      new Client(config);

    assert.notEqual(
      client.connectionParameters
        .ssl,
      false
    );

    if (
      client.connectionParameters
        .ssl &&
      typeof client
        .connectionParameters
        .ssl === "object"
    ) {
      assert.notEqual(
        client
          .connectionParameters
          .ssl
          .rejectUnauthorized,
        false
      );
    }
  }
);

test(
  "DATABASE_URL remota neutraliza tentativa de no-verify",
  () => {
    const config =
      buildDatabasePoolConfig({
        DATABASE_URL:
          "postgresql://user:pass@db.example.com/os_saas?sslmode=no-verify&ssl=no-verify",
      });

    const parsed =
      new URL(
        config.connectionString
      );

    assert.equal(
      parsed.searchParams.get(
        "sslmode"
      ),
      "verify-full"
    );

    assert.equal(
      parsed.searchParams.has(
        "ssl"
      ),
      false
    );

    const client =
      new Client(config);

    assert.notEqual(
      client.connectionParameters
        .ssl,
      false
    );

    if (
      client.connectionParameters
        .ssl &&
      typeof client
        .connectionParameters
        .ssl === "object"
    ) {
      assert.notEqual(
        client
          .connectionParameters
          .ssl
          .rejectUnauthorized,
        false
      );
    }
  }
);

test(
  "DATABASE_URL local nao recebe TLS remoto",
  () => {
    const originalUrl =
      "postgresql://os:secret@127.0.0.1:5432/os_saas_test";

    const config =
      buildDatabasePoolConfig({
        DATABASE_URL:
          originalUrl,
      });

    assert.equal(
      config.connectionString,
      originalUrl
    );
  }
);

test(
  "configuracao DB local tradicional permanece inalterada",
  () => {
    const config =
      buildDatabasePoolConfig({
        DB_HOST:
          "127.0.0.1",
        DB_PORT:
          "5432",
        DB_USER:
          "os",
        DB_PASSWORD:
          "secret",
        DB_NAME:
          "os_saas_test",
      });

    assert.deepEqual(
      config,
      {
        host:
          "127.0.0.1",
        port:
          5432,
        user:
          "os",
        password:
          "secret",
        database:
          "os_saas_test",
      }
    );
  }
);

test(
  "DATABASE_URL invalida falha fechado",
  () => {
    assert.throws(
      () =>
        buildDatabasePoolConfig({
          DATABASE_URL:
            "nao-e-uma-url-postgresql",
        }),
      (error) => {
        assert.equal(
          error.code,
          "INVALID_DATABASE_URL"
        );

        return true;
      }
    );
  }
);

test(
  "DATABASE_URL com protocolo nao PostgreSQL falha fechado",
  () => {
    assert.throws(
      () =>
        buildDatabasePoolConfig({
          DATABASE_URL:
            "https://user:secret@db.example.com/os_saas",
        }),
      (error) => {
        assert.equal(
          error.code,
          "INVALID_DATABASE_URL"
        );

        assert.equal(
          String(error.message)
            .includes("secret"),
          false
        );

        return true;
      }
    );
  }
);
