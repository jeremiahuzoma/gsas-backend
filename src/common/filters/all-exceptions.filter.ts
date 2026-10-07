import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { ZodError } from "zod";

/**
 * One error shape for every endpoint:
 *   { statusCode, error, message }
 *
 * `message` is always safe to show in a toast. Database errors, provider
 * responses and stack traces are logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) {
      // SSE streams have already started; nothing sensible can be written.
      return;
    }

    const { status, message } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.path} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? "Error",
      message,
    });
  }

  private describe(exception: unknown): { status: number; message: string } {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      return { status: 400, message: formatZodError(zodError as ZodError) };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string"
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: string[] }).message[0] ?? exception.message)
            : String((body as { message?: unknown }).message ?? exception.message);
      return { status, message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case "P2025":
          return { status: 404, message: "Record not found" };
        case "P2002":
          return { status: 409, message: "A record with these details already exists" };
        case "P2003":
          return { status: 409, message: "This record is still referenced by other data" };
        default:
          return { status: 500, message: "Internal server error" };
      }
    }

    return { status: 500, message: "Internal server error" };
  }
}

export function formatZodError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
