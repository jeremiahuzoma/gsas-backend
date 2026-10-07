import { SetMetadata } from "@nestjs/common";

export const ALLOW_QUERY_TOKEN_KEY = "allowQueryToken";

/**
 * Lets this route accept the JWT as `?access_token=` in addition to the
 * Authorization header. Only used by the SSE stream, because the browser's
 * EventSource API cannot send custom headers (same as the original stream).
 */
export const AllowQueryToken = () => SetMetadata(ALLOW_QUERY_TOKEN_KEY, true);
