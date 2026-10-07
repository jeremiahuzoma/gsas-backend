import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const testSmsSchema = z.object({
  meterId: z.string().uuid(),
  phoneNumber: z.string().min(7).max(20),
  message: z.string().min(5).max(300).optional(),
});

export class TestSmsDto extends createZodDto(testSmsSchema) {}
