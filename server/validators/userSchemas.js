const { z } = require("zod");

const manageableUserRoles = ["atendimento", "tecnico"];

const phoneSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;

  const digits = String(value).replace(/\D/g, "");
  return digits || null;
}, z.union([
  z
    .string()
    .min(10, "Telefone inválido.")
    .max(13, "Telefone muito longo."),
  z.null(),
]));

const userIdParamSchema = z
  .object({
    id: z.coerce
      .number()
      .int("ID inválido.")
      .positive("ID inválido."),
  })
  .strict();

const inviteUserSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Nome deve ter pelo menos 2 caracteres.")
      .max(120, "Nome muito longo."),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Email inválido.")
      .max(150, "Email muito longo."),

    phone: phoneSchema,

    role: z
      .enum(manageableUserRoles, {
        message: "Perfil inválido.",
      })
      .default("atendimento"),
  })
  .strict();

const updateUserRoleSchema = z
  .object({
    role: z.enum(manageableUserRoles, {
      message: "Perfil inválido.",
    }),
  })
  .strict();

module.exports = {
  manageableUserRoles,
  userIdParamSchema,
  inviteUserSchema,
  updateUserRoleSchema,
};