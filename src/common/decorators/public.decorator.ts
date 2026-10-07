import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Skips JWT authentication (provider webhooks, login, register). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
