const { z } = require("zod");

const optionalText = (max, message) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable();

const clienteSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome deve ter pelo menos 2 caracteres.")
    .max(120, "Nome muito longo."),

  phone: z
    .string()
    .trim()
    .max(20, "Telefone muito longo.")
    .optional()
    .nullable(),

  email: z
    .string()
    .trim()
    .email("Email inválido.")
    .max(150, "Email muito longo.")
    .optional()
    .nullable(),

  cpf_cnpj: optionalText(20, "CPF/CNPJ muito longo."),
  address: optionalText(255, "Endereço muito longo."),
});

const clienteUpdateSchema = clienteSchema.partial();

module.exports = {
  clienteSchema,
  clienteUpdateSchema,
};