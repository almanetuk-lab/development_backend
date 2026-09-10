import { z } from "zod";

// ─── Send Message Schema ────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  sender_id: z.coerce
    .number({ required_error: "sender_id is required." })
    .int()
    .positive("sender_id must be a positive integer."),
  receiver_id: z.coerce
    .number({ required_error: "receiver_id is required." })
    .int()
    .positive("receiver_id must be a positive integer."),
  content: z
    .string()
    .trim()
    .max(5000, "Message cannot exceed 5000 characters.")
    .nullish(),
  attachment_url: z
    .string()
    .url("Invalid attachment URL.")
    .nullish()
    .or(z.literal("")),
}).refine(
  (data) => Boolean(data.content) || Boolean(data.attachment_url),
  { message: "Message content or attachment is required.", path: ["content"] }
).refine(
  (data) => data.sender_id !== data.receiver_id,
  { message: "Cannot send a message to yourself.", path: ["receiver_id"] }
);

// ─── Add Reaction Schema ───────────────────────────────────────────────────

export const addReactionSchema = z.object({
  message_id: z.coerce
    .number({ required_error: "message_id is required." })
    .int()
    .positive("message_id must be a positive integer."),
  user_id: z.coerce
    .number({ required_error: "user_id is required." })
    .int()
    .positive("user_id must be a positive integer."),
  emoji: z
    .string({ required_error: "emoji is required." })
    .trim()
    .min(1, "emoji is required.")
    .max(50, "emoji cannot exceed 50 characters."),
});

// ─── Get Messages Params Schema ─────────────────────────────────────────────

export const getMessagesParamsSchema = z.object({
  userId: z.coerce
    .number({ required_error: "userId is required." })
    .int()
    .positive("userId must be a positive integer."),
});

export const getMessagesQuerySchema = z.object({
  myUserId: z.coerce
    .number({ required_error: "myUserId is required." })
    .int()
    .positive("myUserId must be a positive integer."),
});

// ─── Delete Message Schema ──────────────────────────────────────────────────

export const deleteMessageParamsSchema = z.object({
  id: z.coerce
    .number({ required_error: "Message ID is required." })
    .int()
    .positive("Message ID must be a positive integer."),
});

export const deleteMessageQuerySchema = z.object({
  userId: z.coerce
    .number({ required_error: "userId is required." })
    .int()
    .positive("userId must be a positive integer."),
});
