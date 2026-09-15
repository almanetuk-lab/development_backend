import { ZodError } from "zod";

/**
 * Express middleware factory that validates req.body, req.params, or req.query
 * against a Zod schema. Returns the first validation error as a 400 response.
 *
 * Usage:
 *   router.post("/api/register", validate(registerSchema), registerUser);
 *   router.get("/api/messages/:userId", validate(paramsSchema, "params"), getMessages);
 */
export const validate = (schema, source = "body") => {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      // Replace the source with the parsed (trimmed/transformed) data
      req[source] = parsed;
      next();
    } catch (err) {
      const issues = err.issues || err.errors || [];
      if (err instanceof ZodError || issues.length > 0) {
        // Return the first error message for simplicity (matches existing UX)
        const firstError = issues[0];
        return res.status(400).json({
          error: firstError?.message || "Validation failed",
          message: firstError?.message || "Validation failed",
          // Include full error details for frontend field-level rendering
          errors: issues.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        });
      }
      // Unexpected error — pass to Express error handler
      next(err);
    }
  };
};

/**
 * Standalone parse function for use inside controllers (non-middleware use case).
 * Returns { success: true, data } or { success: false, error, errors }.
 */
export const safeParse = (schema, data) => {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues || result.error.errors || [];
  const firstError = issues[0];
  return {
    success: false,
    error: firstError?.message || "Validation failed",
    errors: issues.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    })),
  };
};
