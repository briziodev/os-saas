const MAX_OS_TOTAL_VALUE = 99999999.99;

function createMoneyPolicyError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function calculateOsTotal(maoObra, valorPecas) {
  const mao = Number(maoObra ?? 0);
  const pecas = Number(valorPecas ?? 0);

  if (!Number.isFinite(mao) || mao < 0) {
    throw createMoneyPolicyError("Valor de mão de obra inválido para calcular a OS.");
  }

  if (!Number.isFinite(pecas) || pecas < 0) {
    throw createMoneyPolicyError("Total de peças inválido para calcular a OS.");
  }

  const total = Number((mao + pecas).toFixed(2));

  if (!Number.isFinite(total) || total > MAX_OS_TOTAL_VALUE) {
    throw createMoneyPolicyError("Total da OS excede o limite permitido.");
  }

  return total;
}

module.exports = {
  MAX_OS_TOTAL_VALUE,
  calculateOsTotal,
};
