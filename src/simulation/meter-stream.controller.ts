import { Controller, MessageEvent, Param, Sse, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { map, Observable, takeUntil, takeWhile, timer } from "rxjs";

import { AllowQueryToken } from "../common/decorators/allow-query-token.decorator";
import type { Env } from "../config/env.validation";
import { MeterAccessGuard } from "../meters/meter-access.guard";
import { MeterEventsService } from "./meter-events.service";
import { MeterTickerService } from "./meter-ticker.service";

/**
 * Server-Sent Events stream for one meter (replaces GET /api/meter-stream).
 *
 * Event names are unchanged: `meter.updated` (snapshot), `simulation.event`
 * (one per log line) and `error`. The stream also drives the simulation tick
 * and closes after SSE_MAX_STREAM_MS (9 minutes) — the browser reconnects.
 * Authentication: `Authorization: Bearer` or `?access_token=` (EventSource
 * cannot set headers); ownership is checked by MeterAccessGuard.
 */
@ApiTags("simulation")
@ApiBearerAuth()
@SkipThrottle()
@Controller("meters/:id/events")
export class MeterStreamController {
  constructor(
    private readonly events: MeterEventsService,
    private readonly ticker: MeterTickerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Sse("stream")
  @AllowQueryToken()
  @UseGuards(MeterAccessGuard)
  @ApiQuery({
    name: "access_token",
    required: false,
    description: "JWT (EventSource cannot send headers)",
  })
  @ApiOperation({ summary: "Live meter stream: meter.updated, simulation.event, error" })
  stream(@Param("id") meterId: string): Observable<MessageEvent> {
    const maxMs = this.config.get("SSE_MAX_STREAM_MS", { infer: true });
    const messages$ = this.events.forMeter(meterId).pipe(
      // Like the original: a "Meter not found" error ends the stream.
      takeWhile((m) => !(m.type === "error" && m.data.message === "Meter not found"), true),
      map((m): MessageEvent => ({ type: m.type, data: m.data })),
    );
    const ticker$ = this.ticker.ticker(meterId);
    return new Observable<MessageEvent>((subscriber) => {
      // Listen first, then join the shared ticker so the first tick is not missed.
      const out = messages$.pipe(takeUntil(timer(maxMs))).subscribe(subscriber);
      const tick = ticker$.subscribe({ error: () => undefined });
      return () => {
        out.unsubscribe();
        tick.unsubscribe();
      };
    });
  }
}
