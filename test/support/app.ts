import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/bootstrap";
import { SMS_PROVIDER } from "../../src/communications/sms-provider.interface";
import { PrismaService } from "../../src/prisma/prisma.service";
import { FakeSmsProvider } from "./fake-sms.provider";

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  sms: FakeSmsProvider;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const sms = new FakeSmsProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: ["error"],
  });
  configureApp(app, { swagger: false });
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    sms,
    http: () => request(app.getHttpServer()),
  };
}

let counter = 0;
export function uniqueEmail(prefix = "user") {
  counter += 1;
  return `${prefix}.${Date.now()}.${counter}@example.com`;
}

/** Registers + logs in a fresh customer; returns token and their meter id. */
export async function signUp(
  ctx: TestContext,
  opts: { phoneNumber?: string; email?: string } = {},
): Promise<{
  token: string;
  userId: string;
  meterId: string;
  email: string;
  auth: [string, string];
}> {
  const email = opts.email ?? uniqueEmail();
  const reg = await ctx
    .http()
    .post("/api/auth/register")
    .send({
      email,
      password: "Password123!",
      ...(opts.phoneNumber ? { phoneNumber: opts.phoneNumber } : {}),
    })
    .expect(201);
  const login = await ctx
    .http()
    .post("/api/auth/login")
    .send({ email, password: "Password123!" })
    .expect(200);
  const token = login.body.accessToken as string;
  const meter = await ctx.prisma.meter.findFirstOrThrow({ where: { user_id: reg.body.user.id } });
  return {
    token,
    userId: reg.body.user.id,
    meterId: meter.id,
    email,
    auth: ["Authorization", `Bearer ${token}`],
  };
}

export async function makeAdmin(ctx: TestContext, userId: string) {
  await ctx.prisma.userRole.upsert({
    where: { user_id_role: { user_id: userId, role: "admin" } },
    update: {},
    create: { user_id: userId, role: "admin" },
  });
}

/** Moves the meter's last tick into the past so the next tick simulates `seconds` of real time. */
export async function rewindTick(ctx: TestContext, meterId: string, seconds: number) {
  await ctx.prisma.meter.update({
    where: { id: meterId },
    data: { last_tick_at: new Date(Date.now() - seconds * 1000) },
  });
}
