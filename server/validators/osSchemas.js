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
];

const moneySchema = z.coerce
  .number()
  .min(0, "Valor não pode ser negativo.")
  .max(999999.99, "Valor muito alto.");

const osCreateSchema = z.object({
  cliente_id: z.coerce
    .number()
    .int("Cliente inválido.")
    .positive("Cliente inválido."),

  placa: z
    .string()
    .trim()
    .max(20, "Placa muito longa.")
    .optional()
    .nullable(),

  modelo: z
    .string()
    .trim()
    .max(120, "Modelo muito longo.")
    .optional()
    .nullable(),

  problema_relatado: z
    .string()
    .trim()
    .min(3, "Problema relatado deve ter pelo menos 3 caracteres.")
    .max(2000, "Problema relatado muito longo."),

  mao_obra: moneySchema.optional().default(0),

  status: z
    .enum(allowedStatuses, {
      message: "Status inválido.",
    })
    .optional()
    .default("triagem"),
});

const osUpdateSchema = z.object({
  cliente_id: z.coerce
    .number()
    .int("Cliente inválido.")
    .positive("Cliente inválido.")
    .optional(),

  placa: z
    .string()
    .trim()
    .max(20, "Placa muito longa.")
    .optional()
    .nullable(),

  modelo: z
    .string()
    .trim()
    .max(120, "Modelo muito longo.")
    .optional()
    .nullable(),

  problema_relatado: z
    .string()
    .trim()
    .min(3, "Problema relatado deve ter pelo menos 3 caracteres.")
    .max(2000, "Problema relatado muito longo.")
    .optional(),

  mao_obra: moneySchema.optional(),

  status: z
    .enum(allowedStatuses, {
      message: "Status inválido.",
    })
    .optional(),
});

const osStatusSchema = z.object({
  status: z.enum(allowedStatuses, {
    message: "Status inválido.",
  }),
});

const osPecaSchema = z.object({
  descricao: z
    .string()
    .trim()
    .min(2, "Descrição da peça deve ter pelo menos 2 caracteres.")
    .max(180, "Descrição da peça muito longa."),

  quantidade: z.coerce
    .number()
    .int("Quantidade deve ser um número inteiro.")
    .positive("Quantidade deve ser maior que zero.")
    .max(999, "Quantidade muito alta."),

  valor_unitario: moneySchema,
});

module.exports = {
  allowedStatuses,
  osCreateSchema,
  osUpdateSchema,
  osStatusSchema,
  osPecaSchema,
};