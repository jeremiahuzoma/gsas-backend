import "dotenv/config";
import { defineConfig } from "prisma/config";

// Loaded by the Prisma CLI (migrate, generate, seed). `dotenv/config` is needed
// because the CLI does not read .env by itself when a config file is present.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
});
