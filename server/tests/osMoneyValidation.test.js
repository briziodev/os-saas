const test = require("node:test");
const assert = require("node:assert/strict");

const {
  osCreateSchema,
  osUpdateSchema,
  osPecaCreateSchema,
  osPecaUpdateSchema,
} = require("../validators/osSchemas");
const {
  MAX_OS_TOTAL_VALUE,
  calculateOsTotal,
} = require("../services/osMoneyPolicy");

function expectValid(schema, payload, name) {
  const result = schema.safeParse(payload);

  assert.equal(
    result.success,
    true,
    `${name}: esperado válido; recebido ${JSON.stringify(result.error?.issues || [])}`
  );
}

function expectInvalid(schema, payload, name) {
  const result = schema.safeParse(payload);
  assert.equal(result.success, false, `${name}: esperado inválido.`);
}

test("criação de OS aceita valores monetários válidos nos limites", () => {
  expectValid(
    osCreateSchema,
    {
      cliente_id: 1,
      problema_relatado: "Teste monetário válido",
      mao_obra: 999999.99,
      valor_pecas: 0.01,
      placa: "ABC1D23",
      modelo: "Teste",
    },
    "osCreateSchema"
  );
});

test("criação e atualização de OS rejeitam mais de 2 casas decimais", () => {
  expectInvalid(
    osCreateSchema,
    {
      cliente_id: 1,
      problema_relatado: "Teste monetário inválido",
      mao_obra: 10.123,
      valor_pecas: 0,
      placa: "ABC1D23",
      modelo: "Teste",
    },
    "osCreateSchema escala"
  );

  expectInvalid(osUpdateSchema, { mao_obra: 10.123 }, "osUpdateSchema escala");
});

test("OS rejeita valor negativo ou acima de R$ 999.999,99", () => {
  expectInvalid(osUpdateSchema, { mao_obra: -0.01 }, "osUpdateSchema negativo");
  expectInvalid(osUpdateSchema, { mao_obra: 1000000 }, "osUpdateSchema máximo");
});

test("peça rejeita valor unitário com mais de 2 casas decimais", () => {
  expectInvalid(
    osPecaCreateSchema,
    { nome: "Filtro", quantidade: 1, valor_unitario: 10.123 },
    "osPecaCreateSchema escala"
  );

  expectInvalid(
    osPecaUpdateSchema,
    { nome: "Filtro", quantidade: 1, valor_unitario: 10.123 },
    "osPecaUpdateSchema escala"
  );
});

test("peça rejeita subtotal individual que excede capacidade do total da OS", () => {
  expectInvalid(
    osPecaCreateSchema,
    { nome: "Peça extrema", quantidade: 999, valor_unitario: 999999.99 },
    "osPecaCreateSchema subtotal"
  );

  expectInvalid(
    osPecaUpdateSchema,
    { nome: "Peça extrema", quantidade: 999, valor_unitario: 999999.99 },
    "osPecaUpdateSchema subtotal"
  );
});

test("política de total da OS aceita o limite e rejeita estouro acumulado", () => {
  assert.equal(calculateOsTotal(0, MAX_OS_TOTAL_VALUE), MAX_OS_TOTAL_VALUE);
  assert.equal(calculateOsTotal(999999.99, 0.01), 1000000);

  assert.throws(
    () => calculateOsTotal(200000, 99899999.01),
    (error) => error?.statusCode === 400 && /excede o limite/.test(error.message)
  );
});
