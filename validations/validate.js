import { ZodError } from "zod";

/**
 * Express middleware factory that validates req.body or req.params against a
 * Zod schema. Returns the first validation error as a 400 response.
 *
 * Usage:
 *   router.post("/api/register", validate(registerSchema), registerUser);
 *   router.get("/api/messages/:userId", validate(paramsSchema, "params"), getMessages);
 *
 * ⚠️ DO NOT call this with source "query". On Express 5, req.query is a
 * getter-only accessor, so the `req[source] = parsed` line below throws
 * `TypeError: Cannot set property query of #<IncomingMessage> which has only a
 * getter` (this module is ESM, so the assignment is in strict mode and does not
 * fail silently). Use `validateQuery` instead.
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
 * Query-string equivalent of `validate`, for Express 5.
 *
 * Rather than reassigning req.query (impossible — see the warning above), the
 * parsed result is exposed as `req.validatedQuery`. This is non-destructive:
 * req.query still holds exactly what the client sent, which matters for audit
 * logging and debugging.
 *
 * Usage:
 *   router.get("/search", validateAccessToken, validateQuery(searchQuerySchema), searchProfiles);
 */
export const validateQuery = (schema) => {
  return (req, res, next) => {
    const result = safeParse(schema, req.query);
    if (!result.success) {
      return res.status(400).json({
        error: result.error,
        message: result.error,
        errors: result.errors,
      });
    }
    req.validatedQuery = result.data;
    next();
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
