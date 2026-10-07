import { createHmac } from "node:crypto";

import { createTestApp, signUp, type TestContext } from "./support/app";

const SECRET = "e2e-webhook-secret"; // see support/env.ts
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

describe("Africa's Talking webhooks (e2e)", () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(async () => ctx.app.close());

  function ussd(
    fields: Record<string, string>,
    opts: { path?: string; signature?: string | null; token?: string } = {},
  ) {
    const body = form(fields);
    const path = opts.path ?? "/api/webhooks/ussd";
    const req = ctx
      .http()
      .post(opts.token ? `${path}?token=${encodeURIComponent(opts.token)}` : path)
      .set("Content-Type", "application/x-www-form-urlencoded");
    if (opts.signature !== null && !opts.token)
      req.set("x-africastalking-signature", opts.signature ?? sign(body));
    return req.send(body);
  }

  describe("signature verification", () => {
    const leg = {
      sessionId: "SIG-1",
      serviceCode: "*384*1100#",
      phoneNumber: "+2340000000000",
      text: "",
    };

    it("rejects unsigned callbacks when a secret is configured", async () => {
      const res = await ussd(leg, { signature: null });
      expect(res.status).toBe(401);
      expect(res.text).toBe("END Request could not be authenticated.");
    });

    it("rejects a bad signature", async () => {
      expect((await ussd(leg, { signature: "0".repeat(64) })).status).toBe(401);
    });

    it("accepts a valid HMAC-SHA256 signature over the raw body", async () => {
      const res = await ussd(leg);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
    });

    it("accepts the ?token= fallback, also on the legacy /api/public/ussd path", async () => {
      const res = await ussd(
        { ...leg, sessionId: "SIG-2" },
        { token: SECRET, path: "/api/public/ussd" },
      );
      expect(res.status).toBe(200);
      const event = await ctx.prisma.webhookEvent.findFirstOrThrow({
        where: { external_id: "SIG-2:" },
      });
      expect(event.signature_verified).toBe(true);
    });

    it("rejects delivery reports without a valid signature", async () => {
      await ctx
        .http()
        .post("/api/webhooks/sms/delivery")
        .type("form")
        .send("id=x&status=Success")
        .expect(401);
    });
  });

  describe("USSD menu", () => {
    let meterNumber: string;
    beforeAll(async () => {
      const u = await signUp(ctx, { phoneNumber: "08055550001" });
      const m = await ctx.prisma.meter.update({
        where: { id: u.meterId },
        data: {
          balance_kwh: 14.82,
          power_watts: 1340,
          current_amps: 5.82,
          voltage: 230.4,
          status: "LOW",
        },
      });
      meterNumber = m.meter_number;
      await ctx.prisma.recharge.create({
        data: {
          meter_id: u.meterId,
          amount_kwh: 20,
          previous_balance: 0,
          new_balance: 20,
          reference: "RCH-TEST",
        },
      });
      await ctx.prisma.meterReading.create({
        data: {
          meter_id: u.meterId,
          voltage: 230,
          current_amps: 1,
          power_watts: 1000,
          frequency_hz: 50,
          power_factor: 0.9,
          energy_kwh: 1.2345,
          balance_kwh: 14.82,
        },
      });
    });
    const call = (sessionId: string, text: string, phoneNumber = "+2348055550001") =>
      ussd({ sessionId, serviceCode: "*384*1100#", phoneNumber, text });

    it("shows the main menu (CON) for a registered number", async () => {
      const res = await call("U-1", "");
      expect(res.text).toBe(
        "CON PREPAID ENERGY MONITOR\n\n1. Meter Balance\n2. Current Load\n3. Meter Status\n4. Today's Consumption\n5. Estimated Remaining Time\n6. Last Recharge\n7. Exit",
      );
    });

    it("answers each option and ends the session (END)", async () => {
      expect((await call("U-2", "1")).text).toBe(
        `END Meter ${meterNumber}\nBalance: 14.82 kWh\nLoad: 1.34 kW\nStatus: LOW`,
      );
      expect((await call("U-3", "2")).text).toBe(
        `END Meter ${meterNumber}\nLoad: 1.34 kW\nCurrent: 5.82 A\nVoltage: 230.4 V`,
      );
      expect((await call("U-4", "3")).text).toBe(
        `END Meter ${meterNumber}\nStatus: LOW\nGSM: CONNECTED\nSimulation: PAUSED`,
      );
      expect((await call("U-5", "4")).text).toBe(
        `END Meter ${meterNumber}\nToday: 1.235 kWh\nSimulated cost: NGN 123.45`,
      );
      expect((await call("U-6", "5")).text).toBe(
        `END Meter ${meterNumber}\nBalance: 14.82 kWh\nAt current load: 11h 3m`,
      );
      expect((await call("U-7", "6")).text).toMatch(
        /^END Last recharge\n20\.00 kWh on \d\d\/\d\d\/\d{4}\nRef: RCH-TEST$/,
      );
      expect((await call("U-8", "7")).text).toBe(
        "END Thank you for using the Energy Monitoring System.",
      );
    });

    it("handles invalid input and lets the caller choose again", async () => {
      expect((await call("U-9", "9")).text).toMatch(/^CON Invalid option\. Please choose again:/);
      expect((await call("U-9", "9*1")).text).toMatch(/^END Meter \d+\nBalance: 14\.82 kWh/);
    });

    it("refuses unregistered numbers", async () => {
      expect((await call("U-10", "", "+2348099999999")).text).toBe(
        "END This phone number is not registered with the Energy Monitoring System.",
      );
    });

    it("normalises local-format MSISDNs", async () => {
      expect((await call("U-11", "", "08055550001")).text).toMatch(/^CON /);
    });

    it("lets callers with several meters pick one first", async () => {
      const u = await signUp(ctx, { phoneNumber: "08055550002" });
      const second = await ctx.prisma.meter.create({
        data: {
          user_id: u.userId,
          meter_number: "450199999999",
          phone_number: "+2348055550002",
          balance_kwh: 33,
        },
      });
      const menu = await call("U-12", "", "+2348055550002");
      expect(menu.text).toMatch(
        /^CON PREPAID ENERGY MONITOR\nSelect meter:\n1\. Meter 4501\d{8}\n2\. Meter 450199999999$/,
      );
      expect((await call("U-12", "2", "+2348055550002")).text).toMatch(
        /^CON PREPAID ENERGY MONITOR\n\n1\. Meter Balance/,
      );
      expect((await call("U-12", "2*1", "+2348055550002")).text).toBe(
        `END Meter ${second.meter_number}\nBalance: 33.00 kWh\nLoad: 0.00 kW\nStatus: ACTIVE`,
      );
      expect((await call("U-13", "5", "+2348055550002")).text).toBe("END Invalid meter selection.");
    });

    it("records every leg and replays duplicates idempotently", async () => {
      const first = await call("U-14", "1");
      await ctx.prisma.meter.updateMany({
        where: { meter_number: meterNumber },
        data: { balance_kwh: 1 },
      });
      const replay = await call("U-14", "1");
      expect(replay.text).toBe(first.text); // stored response, not recomputed
      expect(await ctx.prisma.ussdSession.count({ where: { session_id: "U-14" } })).toBe(1);
      expect(
        await ctx.prisma.webhookEvent.count({
          where: { event_type: "ussd.request", external_id: "U-14:1" },
        }),
      ).toBe(1);
      const session = await ctx.prisma.ussdSession.findFirstOrThrow({
        where: { session_id: "U-14" },
      });
      expect(session).toMatchObject({
        status: "COMPLETED",
        phone_number: "+2348055550001",
        service_code: "*384*1100#",
      });
      expect(session.ended_at).not.toBeNull();
    });

    it("uses admin-edited templates for the header", async () => {
      await ctx.prisma.notificationTemplate.create({
        data: { key: "USSD_WELCOME", body: "WATTS UP METER", channel: "USSD" },
      });
      expect((await call("U-15", "")).text).toMatch(/^CON WATTS UP METER\n/);
      await ctx.prisma.notificationTemplate.delete({ where: { key: "USSD_WELCOME" } });
    });
  });

  describe("SMS delivery reports", () => {
    function report(fields: Record<string, string>) {
      const body = form(fields);
      return ctx
        .http()
        .post("/api/webhooks/sms/delivery")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("x-webhook-signature", sign(body))
        .send(body);
    }

    it("marks DELIVERED only on a Success report, idempotently", async () => {
      const u = await signUp(ctx);
      const log = await ctx.prisma.smsLog.create({
        data: {
          meter_id: u.meterId,
          phone_number: "+2348012345678",
          message: "x",
          status: "SENT",
          provider_message_id: "ATXid_dlr1",
        },
      });
      const sent = await report({
        id: "ATXid_dlr1",
        status: "Sent",
        phoneNumber: "+2348012345678",
      });
      expect(sent.text).toBe("ok");
      expect((await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } })).status).toBe(
        "SENT",
      );

      await report({ id: "ATXid_dlr1", status: "Success", phoneNumber: "+2348012345678" }).expect(
        200,
      );
      const delivered = await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } });
      expect(delivered.status).toBe("DELIVERED");
      expect(delivered.delivered_at).not.toBeNull();

      // Provider retry of the same report is a no-op.
      await ctx.prisma.smsLog.update({ where: { id: log.id }, data: { status: "SENT" } });
      const dup = await report({
        id: "ATXid_dlr1",
        status: "Success",
        phoneNumber: "+2348012345678",
      }).expect(200);
      expect(dup.text).toBe("ok");
      expect((await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } })).status).toBe(
        "SENT",
      );
      expect(
        await ctx.prisma.webhookEvent.count({
          where: { event_type: "sms.delivery", external_id: "ATXid_dlr1:success" },
        }),
      ).toBe(1);
    });

    it("records failure reasons and stops retries for rejected messages", async () => {
      const u = await signUp(ctx);
      const log = await ctx.prisma.smsLog.create({
        data: {
          meter_id: u.meterId,
          phone_number: "+2348012345678",
          message: "x",
          status: "RETRY_SCHEDULED",
          provider_message_id: "ATXid_dlr2",
          next_attempt_at: new Date(),
        },
      });
      await report({
        id: "ATXid_dlr2",
        status: "Rejected",
        failureReason: "UserInBlacklist",
      }).expect(200);
      expect(await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({
        status: "FAILED",
        failure_reason: "UserInBlacklist",
        next_attempt_at: null,
      });
    });

    it("requires a message id", async () => {
      const res = await report({ status: "Success" });
      expect(res.status).toBe(400);
    });

    it("health GETs answer in plain text", async () => {
      expect((await ctx.http().get("/api/webhooks/sms/delivery").expect(200)).text).toBe(
        "SMS delivery webhook is online.",
      );
      expect((await ctx.http().get("/api/public/ussd").expect(200)).text).toMatch(
        /USSD webhook is online/,
      );
    });
  });
});
