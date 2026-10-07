import { createHmac } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type { Request } from "express";

import { timingSafeEqual } from "../common/utils/timing-safe";
import { ProviderConfigService } from "../communications/provider-config";

export interface ParsedWebhook {
  payload: Record<string, string>;
  rawBody: string;
}

export interface SignatureCheck {
  /** true when a shared secret is configured AND the request proved it */
  verified: boolean;
  /** false only when a secret is configured and the request failed the check */
  allowed: boolean;
  reason: string;
}

/**
 * Webhook hardening (migrated from src/lib/webhooks.server.ts).
 *
 * Africa's Talking does not sign callbacks by default (it relies on IP
 * allow-listing), so signing is opt-in: when AFRICASTALKING_WEBHOOK_SECRET is
 * set, every callback must carry a valid HMAC-SHA256 of the raw body in
 * `x-africastalking-signature` / `x-webhook-signature`, or the secret as a
 * `?token=` URL parameter. Without a secret callbacks are accepted and
 * recorded as unverified.
 */
@Injectable()
export class WebhookSecurityService {
  constructor(private readonly providerConfig: ProviderConfigService) {}

  /** Parses the body exactly as received (raw bytes are needed for the HMAC). */
  parse(request: Request & { rawBody?: Buffer }): ParsedWebhook {
    const rawBody = request.rawBody ? request.rawBody.toString("utf8") : "";
    return {
      rawBody,
      payload: parseWebhookPayload(rawBody, request.headers["content-type"] ?? ""),
    };
  }

  verify(request: Request, rawBody: string): SignatureCheck {
    const secret = this.providerConfig.read().webhookSecret;
    return verifyWebhookSignature(secret, rawBody, {
      signature:
        headerValue(request.headers["x-africastalking-signature"]) ??
        headerValue(request.headers["x-webhook-signature"]) ??
        "",
      token: typeof request.query["token"] === "string" ? request.query["token"] : "",
    });
  }
}

export function parseWebhookPayload(rawBody: string, contentType: string): Record<string, string> {
  const payload: Record<string, string> = {};
  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      for (const [k, v] of Object.entries(json)) payload[k] = v == null ? "" : String(v);
    } catch {
      /* leave payload empty; caller validates required fields */
    }
  } else {
    for (const [k, v] of new URLSearchParams(rawBody)) payload[k] = v;
  }
  return payload;
}

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  presented: { signature: string; token: string },
): SignatureCheck {
  if (!secret) return { verified: false, allowed: true, reason: "no shared secret configured" };

  if (presented.signature) {
    const expected = hmacHex(secret, rawBody);
    if (timingSafeEqual(presented.signature.trim().toLowerCase(), expected)) {
      return { verified: true, allowed: true, reason: "hmac ok" };
    }
    return { verified: false, allowed: false, reason: "signature mismatch" };
  }

  // Fallback for providers that cannot sign: shared token in the callback URL.
  if (presented.token && timingSafeEqual(presented.token, secret)) {
    return { verified: true, allowed: true, reason: "url token ok" };
  }
  return { verified: false, allowed: false, reason: "missing signature" };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
