import { z } from "zod";

// ─── Flagged Message Params Schema ──────────────────────────────────────────

export const flagIdParamsSchema = z.object({
  id: z.coerce
    .number({ required_error: "id is required." })
    .int()
    .positive("id must be a positive integer."),
});

// ─── List Flagged Messages Query Schema ─────────────────────────────────────

export const listFlagsQuerySchema = z.object({
  status: z
    .enum(["pending", "dismissed", "warned", "deleted", "all"], {
      message: "status must be one of pending, dismissed, warned, deleted, all.",
    })
    .default("pending"),
  page: z.coerce.number().int().min(1, "page must be at least 1.").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "limit must be at least 1.")
    .max(100, "limit cannot exceed 100.")
    .default(20),
});

// ─── Review Action Body Schema ──────────────────────────────────────────────

export const reviewActionSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(500, "note cannot exceed 500 characters.")
      .nullish(),
  })
  .default({});
