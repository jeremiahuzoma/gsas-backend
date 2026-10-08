import http from "node:http";

import { SimulationService } from "../src/simulation/simulation.service";
import { createTestApp, rewindTick, signUp, type TestContext } from "./support/app";

async function applianceId(ctx: TestContext, name: string) {
  return (await ctx.prisma.appliance.findUniqueOrThrow({ where: { name } })).id;
}

describe("Meter simulation, alerts, SMS and recharge (e2e)", () => {
  let ctx: TestContext;
  let sim: SimulationService;
  beforeAll(async () => {
    ctx = await createTestApp();
    sim = ctx.app.get(SimulationService);
  });
  afterAll(async () => ctx.app.close());
  beforeEach(() => ctx.sms.reset());

  it("builds a rig, consumes energy from it and persists readings", async () => {
    const u = await signUp(ctx, { phoneNumber: "08030000001" });
    const heater = await applianceId(ctx, "Water Heater");
    const bulb = await applianceId(ctx, "LED Bulb");
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ applianceId: heater })
      .expect(201);
    const snap = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ applianceId: bulb })
      .expect(201);
    expect(snap.body.appliances.map((a: { name: string }) => a.name)).toEqual([
      "Water Heater",
      "LED Bulb",
    ]);

    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/start`)
      .set(...u.auth)
      .send({ speed: 600 })
      .expect(200);
    await rewindTick(ctx, u.meterId, 10); // 10 real s × 600 = 6000 simulated s
    const after = await sim.tick(u.meterId);

    // Heater (3000 W, cycle 900 s, duty 0.4) + bulb 10 W over 6000 s, both on at phase 0.
    expect(after!.balanceKwh).toBeLessThan(50);
    expect(after!.totalConsumedKwh).toBeGreaterThan(0);
    expect(after!.simulatedSeconds).toBeGreaterThanOrEqual(6000);
    expect(after!.simulatedSeconds).toBeLessThan(6600); // + a few ms of test latency × 600
    expect(after!.balanceKwh + after!.totalConsumedKwh).toBeCloseTo(50, 3);
    const readings = await ctx
      .http()
      .get(`/api/meters/${u.meterId}/readings?days=1`)
      .set(...u.auth)
      .expect(200);
    expect(readings.body).toHaveLength(1);
    expect(readings.body[0].balance_kwh).toBeCloseTo(after!.balanceKwh, 3);
  });

  it("pause stops consumption; speed is validated; reset restores the initial balance and default rig", async () => {
    const u = await signUp(ctx);
    const fan = await applianceId(ctx, "Ceiling Fan");
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ applianceId: fan })
      .expect(201);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/configurations`)
      .set(...u.auth)
      .send({ name: "Night", makeDefault: true })
      .expect(201);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/start`)
      .set(...u.auth)
      .send({})
      .expect(200);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/pause`)
      .set(...u.auth)
      .expect(200);
    await rewindTick(ctx, u.meterId, 20);
    const paused = await sim.tick(u.meterId);
    expect(paused!.balanceKwh).toBe(50);

    await ctx
      .http()
      .patch(`/api/meters/${u.meterId}/simulation/speed`)
      .set(...u.auth)
      .send({ speed: 0 })
      .expect(400);
    await ctx
      .http()
      .patch(`/api/meters/${u.meterId}/simulation/speed`)
      .set(...u.auth)
      .send({ speed: 300 })
      .expect(200);

    await ctx.prisma.meter.update({
      where: { id: u.meterId },
      data: { balance_kwh: 3, notified_low: true },
    });
    await ctx
      .http()
      .put(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ items: [] })
      .expect(200);
    const reset = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/reset`)
      .set(...u.auth)
      .expect(200);
    expect(reset.body).toMatchObject({
      balanceKwh: 50,
      status: "ACTIVE",
      simulationRunning: false,
      totalConsumedKwh: 0,
    });
    expect(reset.body.appliances.map((a: { name: string }) => a.name)).toEqual(["Ceiling Fan"]);
    const m = await ctx.prisma.meter.findUniqueOrThrow({ where: { id: u.meterId } });
    expect(m.notified_low).toBe(false);
  });

  it("crossing 15 kWh raises exactly one LOW alert and sends one SMS", async () => {
    const u = await signUp(ctx, { phoneNumber: "08030000002" });
    const ac = await applianceId(ctx, "Air Conditioner");
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ applianceId: ac })
      .expect(201);
    await ctx.prisma.meter.update({ where: { id: u.meterId }, data: { balance_kwh: 15.02 } });
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/start`)
      .set(...u.auth)
      .send({ speed: 600 })
      .expect(200);

    await rewindTick(ctx, u.meterId, 1); // 600 s at ≥300 W => ≥0.05 kWh
    const crossed = await sim.tick(u.meterId);
    expect(crossed!.status).toBe("LOW");
    expect(crossed!.events.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^LOW BALANCE THRESHOLD REACHED/),
        "SMS QUEUED",
        "SMS SENT via EbulkSMS",
      ]),
    );
    for (let i = 0; i < 3; i += 1) {
      await rewindTick(ctx, u.meterId, 1);
      await sim.tick(u.meterId);
    }

    const alerts = await ctx.prisma.alert.findMany({ where: { meter_id: u.meterId } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "LOW_BALANCE", severity: "LOW", sms_status: "SENT" });
    expect(alerts[0]!.threshold!.toNumber()).toBe(15);
    expect(ctx.sms.sent).toHaveLength(1);
    expect(ctx.sms.sent[0]!.to).toBe("+2348030000002");
    expect(ctx.sms.sent[0]!.message).toMatch(
      /^ENERGY ALERT: Your prepaid meter 4501\d{8} has 1[45]\.\d\d kWh remaining/,
    );
    const log = await ctx.prisma.smsLog.findFirstOrThrow({ where: { meter_id: u.meterId } });
    expect(log).toMatchObject({
      status: "SENT",
      provider: "fake",
      attempts: 1,
      alert_id: alerts[0]!.id,
    });
    expect(log.provider_message_id).toMatch(/^FAKE-/);
  });

  it("forced thresholds run through the real alert engine, most severe first", async () => {
    const u = await signUp(ctx, { phoneNumber: "08030000003" });
    const urgent = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/force-threshold`)
      .set(...u.auth)
      .send({ balance: 4.9 })
      .expect(200);
    expect(urgent.body.status).toBe("URGENT");
    const depleted = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/force-threshold`)
      .set(...u.auth)
      .send({ balance: 0 })
      .expect(200);
    expect(depleted.body.status).toBe("DEPLETED");
    const types = (
      await ctx.prisma.alert.findMany({
        where: { meter_id: u.meterId },
        orderBy: { created_at: "asc" },
      })
    ).map((a) => a.type);
    expect(types).toEqual(["URGENT_BALANCE", "METER_DEPLETED"]);
    expect(ctx.sms.sent).toHaveLength(2);
    expect(ctx.sms.sent[1]!.message).toMatch(/^METER DEPLETED/);
  });

  it("recharge is transactional, records history, resets flags and lets alerts fire again", async () => {
    const u = await signUp(ctx, { phoneNumber: "08030000004" });
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/force-threshold`)
      .set(...u.auth)
      .send({ balance: 14 })
      .expect(200);
    ctx.sms.reset();

    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/recharge`)
      .set(...u.auth)
      .send({ amountKwh: 5001 })
      .expect(400);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/recharge`)
      .set(...u.auth)
      .send({ amountKwh: -1 })
      .expect(400);
    const res = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/recharge`)
      .set(...u.auth)
      .send({ amountKwh: 50 })
      .expect(200);
    expect(res.body).toMatchObject({ previous: 14, next: 64 });
    expect(res.body.reference).toMatch(/^RCH-[0-9A-Z]+$/);
    expect(res.body.snapshot).toMatchObject({ balanceKwh: 64, status: "ACTIVE" });
    expect(ctx.sms.sent[0]!.message).toMatch(
      /^RECHARGE SUCCESSFUL: Meter 4501\d{8} credited. New balance is 64.00 kWh/,
    );

    const history = await ctx
      .http()
      .get("/api/recharges")
      .set(...u.auth)
      .expect(200);
    expect(history.body[0]).toMatchObject({
      amount_kwh: 50,
      previous_balance: 14,
      new_balance: 64,
    });
    expect(history.body[0].meter.meter_number).toMatch(/^4501/);

    const m = await ctx.prisma.meter.findUniqueOrThrow({ where: { id: u.meterId } });
    expect([m.notified_low, m.notified_critical, m.notified_urgent, m.notified_depleted]).toEqual([
      false,
      false,
      false,
      false,
    ]);

    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/force-threshold`)
      .set(...u.auth)
      .send({ balance: 14.5 })
      .expect(200);
    expect(
      await ctx.prisma.alert.count({ where: { meter_id: u.meterId, type: "LOW_BALANCE" } }),
    ).toBe(2);
  });

  it("concurrent recharges and ticks never lose a balance update", async () => {
    const u = await signUp(ctx);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/start`)
      .set(...u.auth)
      .send({})
      .expect(200);
    await Promise.all([
      ...Array.from({ length: 5 }, () =>
        ctx
          .http()
          .post(`/api/meters/${u.meterId}/recharge`)
          .set(...u.auth)
          .send({ amountKwh: 10 }),
      ),
      ...Array.from({ length: 5 }, () => sim.tick(u.meterId)),
    ]);
    const m = await ctx.prisma.meter.findUniqueOrThrow({ where: { id: u.meterId } });
    expect(m.balance_kwh.toNumber()).toBe(100); // no appliances, so ticks consume nothing
    expect(await ctx.prisma.recharge.count({ where: { meter_id: u.meterId } })).toBe(5);
  });

  it("GSM DISCONNECTED queues SMS; reconnecting flushes the queue", async () => {
    const u = await signUp(ctx, { phoneNumber: "08030000005" });
    await ctx
      .http()
      .patch(`/api/meters/${u.meterId}`)
      .set(...u.auth)
      .send({ gsm: "DISCONNECTED" })
      .expect(200);
    const forced = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/force-threshold`)
      .set(...u.auth)
      .send({ balance: 9 })
      .expect(200);
    expect(forced.body.events.map((e: { message: string }) => e.message)).toContain(
      "GSM module disconnected - SMS held in queue",
    );
    expect(ctx.sms.sent).toHaveLength(0);
    expect(
      (await ctx.prisma.smsLog.findFirstOrThrow({ where: { meter_id: u.meterId } })).status,
    ).toBe("QUEUED");

    const back = await ctx
      .http()
      .patch(`/api/meters/${u.meterId}`)
      .set(...u.auth)
      .send({ gsm: "CONNECTED" })
      .expect(200);
    expect(back.body).toMatchObject({ gsm: "CONNECTED", signalDbm: -68 });
    expect(ctx.sms.sent).toHaveLength(1);
    expect(
      (await ctx.prisma.smsLog.findFirstOrThrow({ where: { meter_id: u.meterId } })).status,
    ).toBe("SENT");
  });

  it("meter settings validate phone numbers and thresholds", async () => {
    const u = await signUp(ctx);
    const bad = await ctx
      .http()
      .patch(`/api/meters/${u.meterId}`)
      .set(...u.auth)
      .send({ phoneNumber: "1234567" })
      .expect(400);
    expect(bad.body.message).toBe("Enter a valid phone number, e.g. 08012345678");
    await ctx
      .http()
      .patch(`/api/meters/${u.meterId}`)
      .set(...u.auth)
      .send({ low: -1 })
      .expect(400);
    const ok = await ctx
      .http()
      .patch(`/api/meters/${u.meterId}`)
      .set(...u.auth)
      .send({ low: 20, tariff: 209.5, phoneNumber: "2348012345678" })
      .expect(200);
    expect(ok.body).toMatchObject({
      tariffPerKwh: 209.5,
      phoneNumber: "+2348012345678",
      thresholds: { low: 20, critical: 10, urgent: 5 },
    });
  });

  it("saved configurations: case-insensitive names, one default, apply replaces the rig", async () => {
    const u = await signUp(ctx);
    const [tv, laptop] = [await applianceId(ctx, "Television"), await applianceId(ctx, "Laptop")];
    const base = `/api/meters/${u.meterId}/configurations`;
    const a = await ctx
      .http()
      .post(base)
      .set(...u.auth)
      .send({ name: "Office", items: [{ applianceId: laptop, isOn: true }], makeDefault: true })
      .expect(201);
    const b = await ctx
      .http()
      .post(base)
      .set(...u.auth)
      .send({ name: "Movie", items: [{ applianceId: tv, isOn: false }] })
      .expect(201);
    await ctx
      .http()
      .post(base)
      .set(...u.auth)
      .send({ name: "OFFICE", items: [{ applianceId: laptop, isOn: false }] })
      .expect(201);
    let list = await ctx
      .http()
      .get(base)
      .set(...u.auth)
      .expect(200);
    expect(list.body).toHaveLength(2);

    await ctx
      .http()
      .post(`${base}/${b.body.id}/default`)
      .set(...u.auth)
      .expect(201);
    list = await ctx
      .http()
      .get(base)
      .set(...u.auth)
      .expect(200);
    expect(
      list.body
        .filter((c: { is_default: boolean }) => c.is_default)
        .map((c: { id: string }) => c.id),
    ).toEqual([b.body.id]);

    const applied = await ctx
      .http()
      .post(`${base}/${b.body.id}/apply`)
      .set(...u.auth)
      .expect(201);
    expect(applied.body.appliances).toEqual([
      expect.objectContaining({ name: "Television", isOn: false }),
    ]);
    await ctx
      .http()
      .post(`${base}/00000000-0000-4000-8000-000000000000/apply`)
      .set(...u.auth)
      .expect(404);
    await ctx
      .http()
      .delete(`${base}/${a.body.id}`)
      .set(...u.auth)
      .expect(200);
    list = await ctx
      .http()
      .get(base)
      .set(...u.auth)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("rig reordering keeps the drag-and-drop order", async () => {
    const u = await signUp(ctx);
    const names = ["Laptop", "LED Bulb", "Television", "Microwave"];
    const items = await Promise.all(
      names.map(async (n) => ({ applianceId: await applianceId(ctx, n), isOn: true })),
    );
    const res = await ctx
      .http()
      .put(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ items })
      .expect(200);
    expect(res.body.appliances.map((a: { name: string }) => a.name)).toEqual(names);
    const link = res.body.appliances[2].id;
    const off = await ctx
      .http()
      .patch(`/api/meters/${u.meterId}/appliances/${link}`)
      .set(...u.auth)
      .send({ isOn: false })
      .expect(200);
    expect(off.body.appliances[2].isOn).toBe(false);
    const removed = await ctx
      .http()
      .delete(`/api/meters/${u.meterId}/appliances/${link}`)
      .set(...u.auth)
      .expect(200);
    expect(removed.body.appliances).toHaveLength(3);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ applianceId: "00000000-0000-4000-8000-000000000000" })
      .expect(400);
  });

  it("demo mode loads 20 kWh at 300× and starts running", async () => {
    const u = await signUp(ctx);
    const res = await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/demo`)
      .set(...u.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      balanceKwh: 20,
      initialBalance: 20,
      simulationSpeed: 300,
      simulationRunning: true,
    });
  });

  it("meter analytics summarise readings, appliances and days", async () => {
    const u = await signUp(ctx);
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/appliances`)
      .set(...u.auth)
      .send({ applianceId: await applianceId(ctx, "Electric Iron") });
    await ctx
      .http()
      .post(`/api/meters/${u.meterId}/simulation/start`)
      .set(...u.auth)
      .send({ speed: 60 });
    for (let i = 0; i < 3; i += 1) {
      await rewindTick(ctx, u.meterId, 2);
      await sim.tick(u.meterId);
    }
    const a = await ctx
      .http()
      .get(`/api/meters/${u.meterId}/analytics?days=1`)
      .set(...u.auth)
      .expect(200);
    expect(a.body.series).toHaveLength(3);
    expect(a.body.totalEnergy).toBeGreaterThan(0);
    expect(a.body.estimatedCost).toBeCloseTo(a.body.totalEnergy * 100, 6);
    expect(a.body.byAppliance[0].name).toBe("Electric Iron");
    expect(a.body.daily).toHaveLength(1);
    await ctx
      .http()
      .get(`/api/meters/${u.meterId}/analytics?days=366`)
      .set(...u.auth)
      .expect(400);
  });

  it("streams meter.updated and simulation.event over SSE", async () => {
    const u = await signUp(ctx, { phoneNumber: "08030000006" });
    await ctx.app.listen(0);
    const port = (ctx.app.getHttpServer().address() as { port: number }).port;

    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/api/meters/${u.meterId}/events/stream?access_token=${u.token}`,
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data)); // closes after SSE_MAX_STREAM_MS
        },
      );
      req.on("error", reject);
      // While connected, a REST action's events must reach the stream too.
      setTimeout(() => {
        // supertest is lazy: .then() actually sends the request.
        ctx
          .http()
          .post(`/api/meters/${u.meterId}/simulation/force-threshold`)
          .set(...u.auth)
          .send({ balance: 14 })
          .then(() => undefined, reject);
      }, 400);
    });

    expect(body).toContain("event: meter.updated");
    expect(body).toContain("event: simulation.event");
    expect(body).toMatch(/LOW BALANCE THRESHOLD REACHED/);
    const snapshots = body.split("\n").filter((l) => l.startsWith('data: {"id"'));
    expect(snapshots.length).toBeGreaterThanOrEqual(3); // ticks every 200 ms in tests
  });
});
