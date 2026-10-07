import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const registerSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  /** Optional sign-up metadata, as the original handle_new_user() trigger accepted. */
  fullName: z.string().trim().min(2).max(80).optional(),
  phoneNumber: z.string().min(7).max(20).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(128),
});

export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
