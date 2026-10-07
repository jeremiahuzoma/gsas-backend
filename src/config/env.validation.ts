import { z } from "zod";

/**
 * Environment contract for the API. Validated once at boot by ConfigModule so a
 * misconfigured deployment fails fast instead of failing on the first request.
 *
 * Africa's Talking variable names are the ones the original application used
 * (AFRICASTALKING_SMS_SENDER_ID, AFRICASTALKING_USSD_SERVICE_CODE). The shorter
 * AFRICASTALKING_SENDER_ID / AFRICASTALKING_SERVICE_CODE are accepted as aliases.
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());

const intFromEnv = (fallback: number, min = 0) =>
  z.coerce.number().int().min(min).default(fallback);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: intFromEnv(3000, 1),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    JWT_EXPIRES_IN: z.string().default("12h"),

    /** Comma-separated list of browser origins allowed by CORS. */
    FRONTEND_URL: z.string().default("http://localhost:5173"),

    AFRICASTALKING_USERNAME: optionalString,
    AFRICASTALKING_API_KEY: optionalString,
    AFRICASTALKING_ENVIRONMENT: z.string().default("sandbox"),
    AFRICASTALKING_SMS_SENDER_ID: optionalString,
    AFRICASTALKING_SENDER_ID: optionalString,
    AFRICASTALKING_USSD_SERVICE_CODE: optionalString,
    AFRICASTALKING_SERVICE_CODE: optionalString,
    AFRICASTALKING_WEBHOOK_SECRET: optionalString,
    SMS_RETRY_SECRET: optionalString,

    /** How often a meter reading row is persisted while simulating. */
    METER_READING_INTERVAL_MS: intFromEnv(5000, 0),
    /** Interval of the live SSE tick loop (original: 1000 ms). */
    SIMULATION_TICK_MS: intFromEnv(1000, 100),
    /** Maximum lifetime of one SSE connection before the browser reconnects (original: 9 min). */
    SSE_MAX_STREAM_MS: intFromEnv(9 * 60 * 1000, 1000),
    /** Sign-in / sign-up attempts allowed per client IP per minute. */
    AUTH_RATE_LIMIT_PER_MINUTE: intFromEnv(10, 1),
    /** In-process SMS retry worker interval. 0 disables it (use the secret-protected endpoint instead). */
    SMS_RETRY_INTERVAL_MS: intFromEnv(0, 0),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: "JWT_SECRET must be at least 32 characters in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
