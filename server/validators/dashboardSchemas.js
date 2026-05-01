const { z } = require("zod");

const allowedDashboardPeriods = ["today", "7d", "month", "all", "custom"];

const optionalDateSchema = z
  .any()
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return undefined;

    const cleaned = String(value).trim();
    return cleaned || undefined;
  })
  .refine(
    (value) =>
      value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value),
    {
      message: "Data inválida. Use o formato YYYY-MM-DD.",
    }
  );

const dashboardQuerySchema = z
  .object({
    period: z
      .enum(allowedDashboardPeriods, {
        message: "Período inválido.",
      })
      .optional()
      .default("month"),

    start_date: optionalDateSchema,
    end_date: optionalDateSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.period !== "custom") {
      return;
    }

    if (!data.start_date) {
      ctx.addIssue({
        code: "custom",
        path: ["start_date"],
        message: "Data inicial obrigatória para período personalizado.",
      });
    }

    if (!data.end_date) {
      ctx.addIssue({
        code: "custom",
        path: ["end_date"],
        message: "Data final obrigatória para período personalizado.",
      });
    }

    if (data.start_date && data.end_date && data.start_date > data.end_date) {
      ctx.addIssue({
        code: "custom",
        path: ["start_date"],
        message: "A data inicial não pode ser maior que a data final.",
      });
    }
  });

module.exports = {
  dashboardQuerySchema,
};