import { z } from "zod";

const email = z
  .string({ message: "email is required." })
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address.")
  .max(100, "Email address cannot exceed 100 characters.");

const code = z
  .string({ message: "code is required." })
  .trim()
  .regex(/^\d{6}$/, "The code must be 6 digits.");

// ─── User: delete own account ────────────────────────────────────────────────

// Password users send { password }; Google/LinkedIn users send { code }.
export const deleteAccountSchema = z
  .object({
    password: z.string().min(1).max(100).optional(),
    code: code.optional(),
  })
  .refine((d) => Boolean(d.password) !== Boolean(d.code), {
    message: "Provide either your password or the emailed code.",
    path: ["password"],
  });

// ─── Public: restore or start fresh ──────────────────────────────────────────

export const recoveryCodeSchema = z.object({
  email,
  purpose: z.enum(["restore", "start_fresh"], { message: "purpose must be restore or start_fresh." }),
});

export const recoveryActionSchema = z.object({ email, code });

// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminUserIdParamsSchema = z.object({
  id: z.coerce.number().int().positive("id must be a positive integer."),
});

export const eraseAccountSchema = z.object({
  confirm_user_id: z.coerce.number().int().positive("confirm_user_id is required."),
  reason: z.string().trim().max(500, "reason cannot exceed 500 characters.").nullish(),
});
