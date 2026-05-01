const { z } = require("zod");

const emailOptionalSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;

  const cleaned = String(value).trim().toLowerCase();
  return cleaned || null;
}, z.union([
  z
    .string()
    .email("Email inválido.")
    .max(150, "Email muito longo."),
  z.null(),
]));

const telefoneSchema = z.preprocess((value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits;
}, z
  .string()
  .min(10, "Telefone inválido.")
  .max(13, "Telefone muito longo.")
);

const clienteIdParamSchema = z
  .object({
    id: z.coerce
      .number()
      .int("ID inválido.")
      .positive("ID inválido."),
  })
  .strict();

const clienteSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, "Nome deve ter pelo menos 2 caracteres.")
      .max(120, "Nome muito longo."),

    email: emailOptionalSchema,

    telefone: telefoneSchema,
  })
  .strict();

module.exports = {
  clienteIdParamSchema,
  clienteSchema,
};