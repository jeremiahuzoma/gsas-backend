/**
 * Environment for e2e tests. DATABASE_URL must point at a database whose name
 * ends in "_test": global-setup wipes and re-creates its schema.
 */
process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/watts_test";
process.env["JWT_SECRET"] = "e2e-test-secret-0123456789abcdef";
process.env["JWT_EXPIRES_IN"] = "1h";
process.env["FRONTEND_URL"] = "http://localhost:5173";
process.env["AFRICASTALKING_WEBHOOK_SECRET"] = "e2e-webhook-secret";
process.env["SMS_RETRY_SECRET"] = "e2e-retry-secret";
process.env["METER_READING_INTERVAL_MS"] = "0";
process.env["SIMULATION_TICK_MS"] = "200";
process.env["SSE_MAX_STREAM_MS"] = "1500";
process.env["SMS_RETRY_INTERVAL_MS"] = "0";
process.env["AUTH_RATE_LIMIT_PER_MINUTE"] = "10000";
