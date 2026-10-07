import { Injectable } from "@nestjs/common";
import { filter, Observable, Subject } from "rxjs";

import type { SimEvent } from "../common/types/sim-event";
import type { MeterSnapshot } from "./simulation.types";

export type MeterStreamMessage =
  | { meterId: string; type: "meter.updated"; data: MeterSnapshot }
  | { meterId: string; type: "simulation.event"; data: SimEvent }
  | { meterId: string; type: "error"; data: { message: string } };

/**
 * In-process publisher for live meter traffic. The simulation tick, REST
 * actions (recharge, forced thresholds, GSM reconnect) and the SSE controller
 * all meet here, so every open dashboard for a meter sees the same updates.
 *
 * Single-process by design (modular monolith). Running several API replicas
 * would need a shared broker (e.g. Postgres LISTEN/NOTIFY) behind this class.
 */
@Injectable()
export class MeterEventsService {
  private readonly bus = new Subject<MeterStreamMessage>();

  forMeter(meterId: string): Observable<MeterStreamMessage> {
    return this.bus.pipe(filter((m) => m.meterId === meterId));
  }

  /** Publishes `meter.updated` followed by one `simulation.event` per event (original order). */
  publishSnapshot(snapshot: MeterSnapshot) {
    this.bus.next({ meterId: snapshot.id, type: "meter.updated", data: snapshot });
    for (const event of snapshot.events) {
      this.bus.next({ meterId: snapshot.id, type: "simulation.event", data: event });
    }
  }

  publishEvents(meterId: string, events: SimEvent[]) {
    for (const event of events) this.bus.next({ meterId, type: "simulation.event", data: event });
  }

  publishError(meterId: string, message: string) {
    this.bus.next({ meterId, type: "error", data: { message } });
  }
}
