import { z } from "zod";

// ─── Reusable field schemas ──────────────────────────────────────────────────

const nameField = (label) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(2, `${label} must be between 2 and 50 characters.`)
    .max(50, `${label} must be between 2 and 50 characters.`)
    .regex(/^[a-zA-Z\s\-]+$/, `${label} can only contain letters, spaces, and hyphens.`);

const emailField = z
  .string({ required_error: "Email address is required." })
  .trim()
  .max(100, "Email address cannot exceed 100 characters.")
  .email("Please enter a valid email address.");

const passwordField = z
  .string({ required_error: "Password is required." })
  .min(8, "Password must be between 8 and 100 characters.")
  .max(100, "Password must be between 8 and 100 characters.")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
  .regex(/\d/, "Password must contain at least one number.")
  .regex(/[@$!%*?&]/, "Password must contain at least one special character (@$!%*?&).");

const RESERVED_USERNAMES = [
  "admin", "support", "root", "system", "api", "help", "contact", "about",
];

const usernameField = z
  .string({ required_error: "Username is required." })
  .trim()
  .toLowerCase()
  .min(3, "Username must be 3–30 characters.")
  .max(30, "Username must be 3–30 characters.")
  .regex(
    /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]+$/,
    "Username can contain letters, numbers, dots (.), or underscores (_). Dots cannot be consecutive or at the start/end."
  )
  .refine((val) => !RESERVED_USERNAMES.includes(val), {
    message: "This username is reserved. Please choose another.",
  });

// ─── Registration Schema ────────────────────────────────────────────────────

export const registerSchema = z.object({
  first_name: nameField("First name"),
  last_name: nameField("Last name"),
  email: emailField,
  password: passwordField,
  profession: z
    .string({ required_error: "Profession is required." })
    .trim()
    .min(2, "Profession must be between 2 and 100 characters.")
    .max(100, "Profession must be between 2 and 100 characters.")
    .regex(
      /^[a-zA-Z0-9\s\-.,]+$/,
      "Profession can only contain letters, numbers, spaces, hyphens, periods, and commas."
    ),
  username: usernameField,
  about_me: z
    .string({ required_error: "About Me is required." })
    .trim()
    .min(10, "About Me section must be between 10 and 1000 characters to build your psychological profile.")
    .max(1000, "About Me section must be between 10 and 1000 characters to build your psychological profile."),
});

// ─── Login Schema ───────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email address is required." })
    .trim()
    .min(1, "Email address is required.")
    .email("Please enter a valid email address."),
  password: z
    .string({ required_error: "Password is required." })
    .min(1, "Password is required."),
});

// ─── Forgot Password Schema ────────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: emailField,
});

// ─── Reset Password Schema ─────────────────────────────────────────────────

export const resetPasswordSchema = z.object({
  password: passwordField,
});

// ─── Change Password Schema ────────────────────────────────────────────────

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: "Current password is required." })
    .min(1, "Current password is required."),
  newPassword: passwordField,
});

// ─── Contact Form Schema ───────────────────────────────────────────────────

export const contactSchema = z.object({
  name: z
    .string({ required_error: "Name is required." })
    .trim()
    .min(2, "Name must be between 2 and 100 characters.")
    .max(100, "Name must be between 2 and 100 characters.")
    .regex(/^[a-zA-Z\s\-]+$/, "Name can only contain letters, spaces, and hyphens."),
  email: emailField,
  subject: z
    .string({ required_error: "Subject is required." })
    .trim()
    .min(3, "Subject must be between 3 and 200 characters.")
    .max(200, "Subject must be between 3 and 200 characters."),
  message: z
    .string({ required_error: "Message is required." })
    .trim()
    .min(10, "Message must be between 10 and 5000 characters.")
    .max(5000, "Message must be between 10 and 5000 characters."),
});

// ─── Newsletter Schema ─────────────────────────────────────────────────────

export const newsletterSchema = z.object({
  email: emailField,
});
