import { createTestApp, makeAdmin, signUp, type TestContext } from "./support/app";

/** The RLS policies of the original schema, re-checked against the NestJS API. */
describe("Authorization / ownership (e2e)", () => {
  let ctx: TestContext;
  let alice: Awaited<ReturnType<typeof signUp>>;
  let bob: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    alice = await signUp(ctx, { phoneNumber: "08020000001" });
    bob = await signUp(ctx, { phoneNumber: "08020000002" });
  });
  afterAll(async () => ctx.app.close());

  it("a customer sees only their own meter", async () => {
    const res = await ctx
      .http()
      .get("/api/meters/current")
      .set(...alice.auth)
      .expect(200);
    expect(res.body.snapshot.id).toBe(alice.meterId);
    const list = await ctx
      .http()
      .get("/api/meters")
      .set(...alice.auth)
      .expect(200);
    expect(list.body.map((m: { id: string }) => m.id)).toEqual([alice.meterId]);
  });

  it("another customer's meter is invisible on every meter route (404, like RLS)", async () => {
    const id = alice.meterId;
    const calls = [
      () =>
        ctx
          .http()
          .get(`/api/meters/${id}`)
          .set(...bob.auth),
      () =>
        ctx
          .http()
          .patch(`/api/meters/${id}`)
          .set(...bob.auth)
          .send({ customerName: "Hacker" }),
      () =>
        ctx
          .http()
          .post(`/api/meters/${id}/simulation/start`)
          .set(...bob.auth)
          .send({}),
      () =>
        ctx
          .http()
          .post(`/api/meters/${id}/simulation/reset`)
          .set(...bob.auth),
      () =>
        ctx
          .http()
          .post(`/api/meters/${id}/simulation/force-threshold`)
          .set(...bob.auth)
          .send({ balance: 0 }),
      () =>
        ctx
          .http()
          .post(`/api/meters/${id}/recharge`)
          .set(...bob.auth)
          .send({ amountKwh: 10 }),
      () =>
        ctx
          .http()
          .post(`/api/meters/${id}/appliances`)
          .set(...bob.auth)
          .send({ applianceId: id }),
      () =>
        ctx
          .http()
          .get(`/api/meters/${id}/readings`)
          .set(...bob.auth),
      () =>
        ctx
          .http()
          .get(`/api/meters/${id}/analytics`)
          .set(...bob.auth),
      () =>
        ctx
          .http()
          .get(`/api/meters/${id}/configurations`)
          .set(...bob.auth),
      () =>
        ctx
          .http()
          .get(`/api/meters/${id}/events/stream`)
          .set(...bob.auth),
      () =>
        ctx
          .http()
          .post(`/api/communications/test-sms`)
          .set(...bob.auth)
          .send({ meterId: id, phoneNumber: "08012345678" }),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(404);
    }
    const meter = await ctx.prisma.meter.findUniqueOrThrow({ where: { id } });
    expect(meter.customer_name).not.toBe("Hacker");
  });

  it("the SSE stream accepts ?access_token= but only for the owner", async () => {
    await ctx
      .http()
      .get(`/api/meters/${alice.meterId}/events/stream?access_token=${bob.token}`)
      .expect(404);
    await ctx
      .http()
      .get(`/api/meters/${alice.meterId}/events/stream?access_token=garbage`)
      .expect(401);
    // query tokens are refused on normal routes
    await ctx.http().get(`/api/meters/${alice.meterId}?access_token=${alice.token}`).expect(401);
  });

  it("history lists are scoped to the caller", async () => {
    await ctx
      .http()
      .post(`/api/meters/${alice.meterId}/simulation/force-threshold`)
      .set(...alice.auth)
      .send({ balance: 14 })
      .expect(200);
    const mine = await ctx
      .http()
      .get("/api/alerts")
      .set(...alice.auth)
      .expect(200);
    expect(mine.body.length).toBeGreaterThan(0);
    const theirs = await ctx
      .http()
      .get("/api/alerts")
      .set(...bob.auth)
      .expect(200);
    expect(theirs.body).toEqual([]);
    const sms = await ctx
      .http()
      .get("/api/sms-logs")
      .set(...bob.auth)
      .expect(200);
    expect(sms.body).toEqual([]);
    const ops = await ctx
      .http()
      .get(`/api/analytics/ops?days=7&meterId=${alice.meterId}`)
      .set(...bob.auth)
      .expect(200);
    expect(ops.body.consumption.readings).toBe(0);
  });

  it("admin routes are forbidden to customers and never trust client-supplied roles", async () => {
    await ctx
      .http()
      .get("/api/admin/meters")
      .set(...bob.auth)
      .expect(403);
    await ctx
      .http()
      .put("/api/admin/templates")
      .set(...bob.auth)
      .send({ key: "LOW_BALANCE", body: "pwned body" })
      .expect(403);
    await ctx
      .http()
      .post("/api/admin/appliances")
      .set(...bob.auth)
      .set("X-Role", "admin")
      .send({})
      .expect(403);
    const ctxRes = await ctx
      .http()
      .get("/api/admin/context")
      .set(...bob.auth)
      .expect(200);
    expect(ctxRes.body).toEqual({ isAdmin: false });
  });

  it("first-admin bootstrap succeeds exactly once, even under concurrent claims", async () => {
    await ctx.prisma.userRole.deleteMany({ where: { role: "admin" } });
    const results = await Promise.all([
      ctx
        .http()
        .post("/api/admin/claim")
        .set(...alice.auth),
      ctx
        .http()
        .post("/api/admin/claim")
        .set(...bob.auth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ctx.prisma.userRole.count({ where: { role: "admin" } })).toBe(1);
  });

  it("an admin can see and manage every meter", async () => {
    const admin = await signUp(ctx);
    await makeAdmin(ctx, admin.userId);
    const meters = await ctx
      .http()
      .get("/api/admin/meters")
      .set(...admin.auth)
      .expect(200);
    const ids = meters.body.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining([alice.meterId, bob.meterId]));
    await ctx
      .http()
      .get(`/api/meters/${bob.meterId}`)
      .set(...admin.auth)
      .expect(200);
    await ctx
      .http()
      .patch(`/api/admin/meters/${bob.meterId}`)
      .set(...admin.auth)
      .send({ gsm: "WEAK", tariff: 125 })
      .expect(200);
    const bobMeter = await ctx.prisma.meter.findUniqueOrThrow({ where: { id: bob.meterId } });
    expect(bobMeter.gsm).toBe("WEAK");
    expect(bobMeter.signal_dbm).toBe(-101);
    expect(bobMeter.tariff_per_kwh.toNumber()).toBe(125);
  });

  it("templates are admin-only to read", async () => {
    const carol = await signUp(ctx);
    await ctx
      .http()
      .get("/api/admin/templates")
      .set(...carol.auth)
      .expect(403);
  });

  it("the appliance catalogue requires authentication", async () => {
    await ctx.http().get("/api/appliances").expect(401);
    const res = await ctx
      .http()
      .get("/api/appliances")
      .set(...bob.auth)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(10);
    expect(res.body[0]).toMatchObject({ name: "LED Bulb", rated_power: 10 });
  });
});
