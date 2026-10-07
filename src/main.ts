import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import type { Env } from "./config/env.validation";

async function bootstrap() {
  // rawBody: webhook signatures are computed over the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Behind a reverse proxy (nginx / PaaS) so rate limiting sees the client IP.
  app.set("trust proxy", 1);
  configureApp(app);

  const port = app.get<ConfigService<Env, true>>(ConfigService).get("PORT", { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api (docs: /api/docs)`, "Bootstrap");
}

void bootstrap();
