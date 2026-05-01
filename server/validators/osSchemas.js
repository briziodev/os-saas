const { z } = require("zod");

const allowedStatuses = [
  "triagem",
  "em_analise",
  "aguardando_aprovacao",
  "aprovado",
  "em_execucao",
  "aguardando_peca",
  "pronto_retirada",
  "encerrado",
  "orcamento_enviado",
  "finalizado",
  "cancelado",
];

const positiveIntSchema = (message) =>
  z.preprocess((value) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }, z
    .number({ message })
    .int(message)
    .positive(message)
  );

const moneySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return 0;
  return value;
}, z.coerce
  .number()
  .min(0, "Valor não pode ser negativo.")
  .max(999999.99, "Valor muito alto.")
);

const optionalMoneySchema = z
  .any()
  .optional()
  .transform((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    return Number(value);
  })
  .refine((value) => value === undefined || Number.isFinite(value), {
    message: "Valor inválido.",
  })
  .refine((value) => value === undefined || value >= 0, {
    message: "Valor não pode ser negativo.",
  })
  .refine((value) => value === undefined || value <= 999999.99, {
    message: "Valor muito alto.",
  });
const createTextOrNullSchema = (max, message) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return null;

    const cleaned = String(value).trim();
    return cleaned || null;
  }, z.union([
    z.string().max(max, message),
    z.null(),
  ]));

const updateTextOrNullSchema = (max, message) =>
  z
    .any()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;

      const cleaned = String(value).trim();
      return cleaned || null;
    })
    .refine(
      (value) =>
        value === undefined ||
        value === null ||
        String(value).length <= max,
      { message }
    );

const osIdParamSchema = z
  .object({
    id: positiveIntSchema("ID inválido."),
  })
  .strict();

const osPecaParamSchema = z
  .object({
    id: positiveIntSchema("ID inválido."),
    pecaId: positiveIntSchema("ID da peça inválido."),
  })
  .strict();

const osCreateSchema = z
  .object({
    cliente_id: positiveIntSchema("Cliente inválido."),

    problema_relatado: z
      .string()
      .trim()
      .min(3, "Problema relatado deve ter pelo menos 3 caracteres.")
      .max(2000, "Problema relatado muito longo."),

    mao_obra: moneySchema,

    valor_pecas: moneySchema,

    placa: createTextOrNullSchema(20, "Placa muito longa.").optional().default(null),
modelo: createTextOrNullSchema(120, "Modelo muito longo.").optional().default(null),
  })
  .strict();

const osUpdateSchema = z
  .object({
    status: z
      .enum(allowedStatuses, {
        message: "Status inválido.",
      })
      .optional(),

    problema_relatado: z
      .string()
      .trim()
      .min(3, "Problema relatado deve ter pelo menos 3 caracteres.")
      .max(2000, "Problema relatado muito longo.")
      .optional(),

    mao_obra: optionalMoneySchema,

    placa: updateTextOrNullSchema(20, "Placa muito longa."),
    modelo: updateTextOrNullSchema(120, "Modelo muito longo."),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe pelo menos um campo para atualizar.",
  });

const osPecaCreateSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Nome da peça deve ter pelo menos 2 caracteres.")
      .max(180, "Nome da peça muito longo."),

    quantidade: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return 1;
      return value;
    }, z.coerce
      .number()
      .int("Quantidade deve ser um número inteiro.")
      .positive("Quantidade deve ser maior que zero.")
      .max(999, "Quantidade muito alta.")
    ),

    valor_unitario: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return 0;
      return value;
    }, z.coerce
      .number()
      .min(0, "Valor unitário não pode ser negativo.")
      .max(999999.99, "Valor unitário muito alto.")
    ),
  })
  .strict();

const osPecaUpdateSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Nome da peça deve ter pelo menos 2 caracteres.")
      .max(180, "Nome da peça muito longo."),

    quantidade: z.coerce
      .number()
      .int("Quantidade deve ser um número inteiro.")
      .positive("Quantidade deve ser maior que zero.")
      .max(999, "Quantidade muito alta."),

    valor_unitario: z.coerce
      .number()
      .min(0, "Valor unitário não pode ser negativo.")
      .max(999999.99, "Valor unitário muito alto."),
  })
  .strict();

module.exports = {
  allowedStatuses,
  osIdParamSchema,
  osPecaParamSchema,
  osCreateSchema,
  osUpdateSchema,
  osPecaCreateSchema,
  osPecaUpdateSchema,
};