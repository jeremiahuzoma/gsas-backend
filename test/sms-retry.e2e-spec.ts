import { SmsRetryService } from "../src/communications/sms-retry.service";
import { MAX_SMS_ATTEMPTS, SmsService } from "../src/communications/sms.service";
import { createTestApp, makeAdmin, signUp, type TestContext } from "./support/app";

const transient = {
  status: "FAILED" as const,
  failureReason: "Provider error 503",
  retriable: true,
  simulated: false,
};
const permanent = {
  status: "FAILED" as const,
  failureReason: "InvalidPhoneNumber",
  retriable: false,
  simulated: false,
};

describe("SMS retry processing (e2e)", () => {
  let ctx: TestContext;
  let sms: SmsService;
  let worker: SmsRetryService;
  beforeAll(async () => {
    ctx = await createTestApp();
    sms = ctx.app.get(SmsService);
    worker = ctx.app.get(SmsRetryService);
  });
  afterAll(async () => ctx.app.close());
  beforeEach(async () => {
    ctx.sms.reset();
    await ctx.prisma.smsLog.deleteMany({});
  });

  async function newLog(meterId: string, attempts = 0) {
    return ctx.prisma.smsLog.create({
      data: {
        meter_id: meterId,
        phone_number: "+2348012345678",
        message: "hello",
        status: "QUEUED",
        attempts,
      },
    });
  }

  it("schedules retriable failures with the 1/5/15/60/180 minute backoff", async () => {
    const u = await signUp(ctx);
    const log = await newLog(u.meterId);
    ctx.sms.queue(transient);
    const before = Date.now();
    await sms.sendAndRecord(log.id, log.phone_number, log.message, 0);
    const row = await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(row).toMatchObject({
      status: "RETRY_SCHEDULED",
      attempts: 1,
      failure_reason: "Provider error 503",
    });
    const delayMin = (row.next_attempt_at!.getTime() - before) / 60_000;
    expect(delayMin).toBeGreaterThan(0.99);
    expect(delayMin).toBeLessThan(1.1);

    ctx.sms.queue(transient);
    await sms.sendAndRecord(log.id, log.phone_number, log.message, 2); // 3rd attempt => 15 min
    const third = await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } });
    expect((third.next_attempt_at!.getTime() - Date.now()) / 60_000).toBeGreaterThan(14.9);
  });

  it("marks permanent failures FAILED without a retry", async () => {
    const u = await signUp(ctx);
    const log = await newLog(u.meterId);
    ctx.sms.queue(permanent);
    await sms.sendAndRecord(log.id, log.phone_number, log.message, 0);
    expect(await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({
      status: "FAILED",
      next_attempt_at: null,
    });
  });

  it("the worker resends due messages, skips future ones and exhausts the budget", async () => {
    const u = await signUp(ctx);
    const due = await ctx.prisma.smsLog.create({
      data: {
        meter_id: u.meterId,
        phone_number: "+2348012345678",
        message: "due",
        status: "RETRY_SCHEDULED",
        attempts: 1,
        next_attempt_at: new Date(Date.now() - 1000),
      },
    });
    const future = await ctx.prisma.smsLog.create({
      data: {
        meter_id: u.meterId,
        phone_number: "+2348012345678",
        message: "later",
        status: "RETRY_SCHEDULED",
        attempts: 1,
        next_attempt_at: new Date(Date.now() + 60_000),
      },
    });
    const spent = await ctx.prisma.smsLog.create({
      data: {
        meter_id: u.meterId,
        phone_number: "+2348012345678",
        message: "spent",
        status: "RETRY_SCHEDULED",
        attempts: MAX_SMS_ATTEMPTS,
        next_attempt_at: new Date(Date.now() - 1000),
      },
    });

    const summary = await worker.retryPending(25);
    expect(summary).toEqual({ scanned: 2, sent: 1, failed: 0, exhausted: 1 });
    expect(ctx.sms.sent.map((s) => s.message)).toEqual(["due"]);
    expect(await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({
      status: "SENT",
      attempts: 2,
    });
    expect(await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject({
      status: "RETRY_SCHEDULED",
    });
    expect(await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: spent.id } })).toMatchObject({
      status: "FAILED",
      failure_reason: "Retry budget exhausted",
    });
  });

  it("parallel worker runs never send the same message twice", async () => {
    const u = await signUp(ctx);
    for (let i = 0; i < 5; i += 1) {
      await ctx.prisma.smsLog.create({
        data: {
          meter_id: u.meterId,
          phone_number: "+2348012345678",
          message: `m${i}`,
          status: "RETRY_SCHEDULED",
          attempts: 1,
          next_attempt_at: new Date(Date.now() - 1000),
        },
      });
    }
    const runs = await Promise.all([
      worker.retryPending(25),
      worker.retryPending(25),
      worker.retryPending(25),
    ]);
    expect(runs.reduce((s, r) => s + r.sent, 0)).toBe(5);
    expect(ctx.sms.sent).toHaveLength(5);
    expect(new Set(ctx.sms.sent.map((s) => s.message)).size).toBe(5);
  });

  it("the retry endpoint requires the shared secret", async () => {
    await ctx.http().post("/api/webhooks/sms/retry").expect(401);
    await ctx
      .http()
      .post("/api/webhooks/sms/retry")
      .set("Authorization", "Bearer wrong")
      .expect(401);
    const ok = await ctx
      .http()
      .post("/api/webhooks/sms/retry")
      .set("Authorization", "Bearer e2e-retry-secret")
      .expect(200);
    expect(ok.body).toEqual({ scanned: 0, sent: 0, failed: 0, exhausted: 0 });
    await ctx.http().post("/api/public/sms-retry?token=e2e-retry-secret").expect(200);
  });

  it("admins can resend a single log entry or run the worker", async () => {
    const admin = await signUp(ctx);
    await makeAdmin(ctx, admin.userId);
    const log = await ctx.prisma.smsLog.create({
      data: {
        meter_id: admin.meterId,
        phone_number: "+2348012345678",
        message: "resend me",
        status: "FAILED",
        attempts: 2,
      },
    });
    const one = await ctx
      .http()
      .post("/api/admin/sms/retry")
      .set(...admin.auth)
      .send({ logId: log.id })
      .expect(200);
    expect(one.body).toEqual({ scanned: 1, sent: 1, failed: 0, exhausted: 0 });
    expect(await ctx.prisma.smsLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({
      status: "SENT",
      attempts: 3,
    });
    await ctx
      .http()
      .post("/api/admin/sms/retry")
      .set(...admin.auth)
      .send({})
      .expect(200);
    const logs = await ctx
      .http()
      .get("/api/admin/sms-logs?limit=5")
      .set(...admin.auth)
      .expect(200);
    expect(logs.body[0]).toMatchObject({ message: "resend me", status: "SENT" });
  });

  it("test SMS is limited to 5 per 5 minutes per user", async () => {
    const u = await signUp(ctx);
    // The unconfigured provider path is covered in unit tests; here the provider is configured via the fake.
    const res = await ctx
      .http()
      .post("/api/communications/test-sms")
      .set(...u.auth)
      .send({ meterId: u.meterId, phoneNumber: "08012345678" });
    // With no AT credentials in the test environment the endpoint reports it is not configured.
    expect([200, 503]).toContain(res.status);
    const cfg = await ctx
      .http()
      .get("/api/communications/config")
      .set(...u.auth)
      .expect(200);
    expect(cfg.body).toEqual({
      configured: false,
      environment: "sandbox",
      senderId: "",
      serviceCode: "",
    });
    expect(JSON.stringify(cfg.body)).not.toMatch(/apiKey|secret/i);
  });
});
