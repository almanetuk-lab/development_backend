import { z } from "zod";

// ─── Create Checkout Session Schema ─────────────────────────────────────────

export const createCheckoutSchema = z.object({
  user_id: z.coerce
    .number({ required_error: "user_id is required." })
    .int()
    .positive("user_id must be a positive integer."),
  plan: z.object({
    id: z.coerce.number({ required_error: "Plan ID is required." }).int().positive(),
    name: z.string({ required_error: "Plan name is required." }).min(1),
    price: z.coerce.number({ required_error: "Plan price is required." }).min(0, "Price cannot be negative."),
    duration: z.coerce.number().int().positive().optional(),
  }, { required_error: "Plan is required." }),
});
