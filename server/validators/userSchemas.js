const { z } = require("zod");

const allowedRoles = ["admin", "atendimento", "tecnico"];

const inviteUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome deve ter pelo menos 2 caracteres.")
    .max(120, "Nome muito longo."),

  email: z
    .string()
    .trim()
    .email("Email inválido.")
    .max(150, "Email muito longo."),

  phone: z
    .string()
    .trim()
    .max(20, "Telefone muito longo.")
    .optional()
    .nullable(),

  role: z.enum(allowedRoles, {
    message: "Perfil inválido.",
  }),
});

const updateUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nome deve ter pelo menos 2 caracteres.")
    .max(120, "Nome muito longo.")
    .optional(),

  phone: z
    .string()
    .trim()
    .max(20, "Telefone muito longo.")
    .optional()
    .nullable(),

  role: z
    .enum(allowedRoles, {
      message: "Perfil inválido.",
    })
    .optional(),

  is_active: z.boolean().optional(),
});

module.exports = {
  inviteUserSchema,
  updateUserSchema,
  allowedRoles,
};