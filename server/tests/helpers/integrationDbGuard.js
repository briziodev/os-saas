const assert = require("node:assert/strict");

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

const EXPECTED_TEST_DATABASE =
  "os_saas_test";

const REQUIRED_CONFIRMATION = "1";

function assertSafeIntegrationDatabase({
  target,
  confirmation,
}) {
  assert.ok(
    target &&
      typeof target === "object",
    "Teste bloqueado: destino do banco ausente."
  );

  const host =
    String(target.host || "").trim();

  const database =
    String(target.database || "").trim();

  const source =
    String(target.source || "não informado");

  assert.ok(
    LOCAL_HOSTS.has(host),
    [
      "Teste bloqueado: somente PostgreSQL local é permitido.",
      `Host encontrado: ${host || "não informado"}.`,
      `Origem: ${source}.`,
    ].join(" ")
  );

  assert.equal(
    database,
    EXPECTED_TEST_DATABASE,
    [
      "Teste bloqueado: banco dedicado de integração obrigatório.",
      `Database esperado: ${EXPECTED_TEST_DATABASE}.`,
      `Database encontrado: ${database || "não informado"}.`,
      `Origem: ${source}.`,
    ].join(" ")
  );

  assert.equal(
    String(confirmation || "").trim(),
    REQUIRED_CONFIRMATION,
    [
      "Teste bloqueado: confirmação explícita ausente.",
      "Defina OS_SAAS_INTEGRATION_TEST=1 somente para executar",
      "contra o banco local dedicado os_saas_test.",
    ].join(" ")
  );
}

module.exports = {
  EXPECTED_TEST_DATABASE,
  assertSafeIntegrationDatabase,
};