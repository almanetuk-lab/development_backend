import { z } from "zod";
import { MAX_BAN_DAYS } from "../utils/banRules.js";

// ─── Ban (Deactivate) User Schema ───────────────────────────────────────────

export const banUserSchema = z
  .object({
    user_id: z.coerce.number().int().positive("user_id must be a positive integer."),
    reason: z
      .string({ message: "reason is required." })
      .trim()
      .min(1, "reason is required.")
      .max(500, "reason cannot exceed 500 characters."),
    duration_days: z.coerce
      .number()
      .int("duration_days must be a whole number.")
      .min(1, "duration_days must be at least 1.")
      .max(MAX_BAN_DAYS, `duration_days cannot exceed ${MAX_BAN_DAYS}.`)
      .nullish(),
    permanent: z.boolean().optional().default(false),
    flag_id: z.coerce.number().int().positive().nullish(),
  })
  .refine((d) => d.permanent !== Boolean(d.duration_days), {
    message: "Provide either duration_days or permanent: true (not both).",
    path: ["duration_days"],
  });

// ─── Reactivate User Schema ─────────────────────────────────────────────────

export const reactivateUserSchema = z.object({
  user_id: z.coerce.number().int().positive("user_id must be a positive integer."),
  note: z.string().trim().max(500, "note cannot exceed 500 characters.").nullish(),
});
