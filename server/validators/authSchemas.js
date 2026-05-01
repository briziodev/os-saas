const { z } = require("zod");

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Email inválido.")
      .max(150, "Email muito longo."),

    password: z
      .string()
      .min(6, "Senha deve ter pelo menos 6 caracteres.")
      .max(100, "Senha muito longa."),
  })
  .strict();

const activateAccountSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(10, "Token inválido.")
      .max(255, "Token muito longo."),

    password: z
      .string()
      .min(6, "Senha deve ter pelo menos 6 caracteres.")
      .max(100, "Senha muito longa."),

    confirmPassword: z
      .string()
      .min(6, "Confirmação de senha deve ter pelo menos 6 caracteres.")
      .max(100, "Confirmação de senha muito longa."),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

module.exports = {
  loginSchema,
  activateAccountSchema,
};