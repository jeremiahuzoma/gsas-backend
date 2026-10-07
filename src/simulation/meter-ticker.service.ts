import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { exhaustMap, finalize, from, Observable, share, timer } from "rxjs";

import type { Env } from "../config/env.validation";
import { MeterEventsService } from "./meter-events.service";
import { SimulationService } from "./simulation.service";

/**
 * Drives the simulation while somebody is watching, exactly like the original
 * SSE route did (one tick per second per open stream). Streams for the same
 * meter share one ticker, so two open tabs do not double the write rate.
 */
@Injectable()
export class MeterTickerService {
  private readonly logger = new Logger(MeterTickerService.name);
  private readonly tickers = new Map<string, Observable<unknown>>();

  constructor(
    private readonly simulation: SimulationService,
    private readonly events: MeterEventsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  ticker(meterId: string): Observable<unknown> {
    const existing = this.tickers.get(meterId);
    if (existing) return existing;

    const tickMs = this.config.get("SIMULATION_TICK_MS", { infer: true });
    const ticker$ = timer(0, tickMs).pipe(
      // exhaustMap: never start a tick while the previous one is still running.
      exhaustMap(() => from(this.runTick(meterId))),
      finalize(() => this.tickers.delete(meterId)),
      share({ resetOnRefCountZero: true }),
    );
    this.tickers.set(meterId, ticker$);
    return ticker$;
  }

  private async runTick(meterId: string) {
    try {
      const snapshot = await this.simulation.tick(meterId);
      if (!snapshot) this.events.publishError(meterId, "Meter not found");
    } catch (error) {
      this.logger.error(
        `tick failed for meter ${meterId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.events.publishError(meterId, "Simulation tick failed");
    }
  }
}
