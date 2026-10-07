import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { map, Observable } from "rxjs";

import { toJsonSafe } from "../utils/serialize";

/** Applies toJsonSafe() to every JSON response body. Strings (USSD text) pass through untouched. */
@Injectable()
export class JsonSafeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => (typeof body === "string" ? body : toJsonSafe(body))));
  }
}
