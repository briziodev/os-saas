const { z } = require("zod");

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Email inválido.")
    .max(150, "Email muito longo."),

  password: z
    .string()
    .min(6, "Senha deve ter pelo menos 6 caracteres.")
    .max(100, "Senha muito longa."),
});

const activateAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome deve ter pelo menos 2 caracteres.")
    .max(120, "Nome muito longo.")
    .optional(),

  password: z
    .string()
    .min(6, "Senha deve ter pelo menos 6 caracteres.")
    .max(100, "Senha muito longa."),
});

module.exports = {
  loginSchema,
  activateAccountSchema,
};