const { z } = require("zod");
const {
  addNewPasswordIssues,
} = require("../utils/passwordPolicy");

function newPasswordSchema() {
  return z
    .string()
    .superRefine((password, context) => {
      addNewPasswordIssues(password, context);
    });
}

const passwordConfirmationSchema = z
  .string()
  .min(1, "Confirmação de senha obrigatória.")
  .max(100, "Confirmação de senha muito longa.");

const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Email inválido.")
      .max(150, "Email muito longo."),

    // Login continua aceitando senhas legadas.
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

    password: newPasswordSchema(),

    confirmPassword: passwordConfirmationSchema,
  })
  .strict()
  .refine(
    (data) => data.password === data.confirmPassword,
    {
      message: "As senhas não coincidem.",
      path: ["confirmPassword"],
    }
  );

const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Senha atual obrigatória.")
      .max(100, "Senha atual muito longa."),

    newPassword: newPasswordSchema(),

    confirmPassword: passwordConfirmationSchema,
  })
  .strict()
  .refine(
    (data) => data.newPassword === data.confirmPassword,
    {
      message: "As senhas não coincidem.",
      path: ["confirmPassword"],
    }
  );

module.exports = {
  loginSchema,
  activateAccountSchema,
  changePasswordSchema,
};