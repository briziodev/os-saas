const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertSafeIntegrationDatabase,
} = require("./helpers/integrationDbGuard");

test(
  "guard aceita somente banco local dedicado com confirmacao explicita",
  () => {
    assert.doesNotThrow(() => {
      assertSafeIntegrationDatabase({
        target: {
          host: "127.0.0.1",
          port: "5432",
          database: "os_saas_test",
          source: "DB_*",
        },
        confirmation: "1",
      });
    });
  }
);

test(
  "guard rejeita banco local normal os_saas",
  () => {
    assert.throws(
      () =>
        assertSafeIntegrationDatabase({
          target: {
            host: "localhost",
            port: "5432",
            database: "os_saas",
            source: "DB_*",
          },
          confirmation: "1",
        }),
      /banco dedicado de integração obrigatório/
    );
  }
);

test(
  "guard rejeita host remoto mesmo com nome de banco de teste",
  () => {
    assert.throws(
      () =>
        assertSafeIntegrationDatabase({
          target: {
            host: "db.example.com",
            port: "5432",
            database: "os_saas_test",
            source: "DATABASE_URL",
          },
          confirmation: "1",
        }),
      /somente PostgreSQL local é permitido/
    );
  }
);

test(
  "guard rejeita execucao sem confirmacao explicita",
  () => {
    assert.throws(
      () =>
        assertSafeIntegrationDatabase({
          target: {
            host: "::1",
            port: "5432",
            database: "os_saas_test",
            source: "DB_*",
          },
          confirmation: "",
        }),
      /confirmação explícita ausente/
    );
  }
);