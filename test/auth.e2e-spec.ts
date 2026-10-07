import bcrypt from "bcryptjs";

import { createTestApp, signUp, uniqueEmail, type TestContext } from "./support/app";

describe("Authentication (e2e)", () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(async () => ctx.app.close());

  it("registers a customer with profile, role and a 4501xxxxxxxx meter in one go", async () => {
    const email = uniqueEmail("New.User");
    const res = await ctx
      .http()
      .post("/api/auth/register")
      .send({ email, password: "Password123!", fullName: "Ada Obi", phoneNumber: "0803 111 2222" })
      .expect(201);

    expect(res.body.user).toMatchObject({
      email: email.toLowerCase(),
      fullName: "Ada Obi",
      phoneNumber: "+2348031112222",
      roles: ["customer"],
      isAdmin: false,
    });
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: res.body.user.id },
      include: { profile: true, roles: true, meters: true },
    });
    expect(user.password_hash).not.toContain("Password123!");
    expect(await bcrypt.compare("Password123!", user.password_hash)).toBe(true);
    expect(user.meters).toHaveLength(1);
    expect(user.meters[0]!.meter_number).toMatch(/^4501\d{8}$/);
    expect(user.meters[0]!.customer_name).toBe("Ada Obi");
    expect(user.meters[0]!.phone_number).toBe("+2348031112222");
  });

  it("defaults the name to the email local part, as the Supabase trigger did", async () => {
    const res = await ctx
      .http()
      .post("/api/auth/register")
      .send({ email: "chidi.okafor@example.com", password: "Password123!" });
    expect(res.status).toBe(201);
    expect(res.body.user.fullName).toBe("chidi.okafor");
  });

  it("rejects duplicate emails (case-insensitive) and weak input", async () => {
    const { email } = await signUp(ctx);
    await ctx
      .http()
      .post("/api/auth/register")
      .send({ email: email.toUpperCase(), password: "Password123!" })
      .expect(409);
    const bad = await ctx
      .http()
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "x" })
      .expect(400);
    expect(bad.body.message).toMatch(/email/i);
    await ctx
      .http()
      .post("/api/auth/register")
      .send({ email: uniqueEmail(), password: "Password123!", phoneNumber: "12345678" })
      .expect(400);
  });

  it("logs in, returns the current user and rejects bad credentials with one generic message", async () => {
    const { email, auth } = await signUp(ctx);
    const me = await ctx
      .http()
      .get("/api/auth/me")
      .set(...auth)
      .expect(200);
    expect(me.body.email).toBe(email);
    const wrong = await ctx
      .http()
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" })
      .expect(401);
    const unknown = await ctx
      .http()
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "x" })
      .expect(401);
    expect(wrong.body.message).toBe("Invalid login credentials");
    expect(unknown.body.message).toBe("Invalid login credentials");
  });

  it("accepts bcrypt hashes imported from Supabase ($2a$)", async () => {
    const email = uniqueEmail("imported");
    // Supabase (GoTrue) stores "$2a$" bcrypt hashes; same algorithm as "$2b$".
    const hash = (await bcrypt.hash("Imported123!", 10)).replace(/^\$2b\$/, "$2a$");
    expect(hash.startsWith("$2a$")).toBe(true);
    await ctx.prisma.user.create({ data: { email, password_hash: hash } });
    await ctx.http().post("/api/auth/login").send({ email, password: "Imported123!" }).expect(200);
  });

  it("requires a valid token on private routes", async () => {
    await ctx.http().get("/api/meters/current").expect(401);
    await ctx
      .http()
      .get("/api/meters/current")
      .set("Authorization", "Bearer not.a.jwt")
      .expect(401);
    const { token } = await signUp(ctx);
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", ver: 0 })).toString("base64url")}.${s}`;
    expect(p).toBeDefined();
    await ctx.http().get("/api/auth/me").set("Authorization", `Bearer ${tampered}`).expect(401);
  });

  it("logout revokes every token issued before it", async () => {
    const { auth, email } = await signUp(ctx);
    const second = await ctx
      .http()
      .post("/api/auth/login")
      .send({ email, password: "Password123!" })
      .expect(200);
    await ctx
      .http()
      .post("/api/auth/logout")
      .set(...auth)
      .expect(200);
    await ctx
      .http()
      .get("/api/auth/me")
      .set(...auth)
      .expect(401);
    await ctx
      .http()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${second.body.accessToken}`)
      .expect(401);
    const fresh = await ctx
      .http()
      .post("/api/auth/login")
      .send({ email, password: "Password123!" })
      .expect(200);
    await ctx
      .http()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${fresh.body.accessToken}`)
      .expect(200);
  });

  it("never exposes the password hash", async () => {
    const { auth } = await signUp(ctx);
    const me = await ctx
      .http()
      .get("/api/auth/me")
      .set(...auth)
      .expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(/password|hash/i);
  });
});
