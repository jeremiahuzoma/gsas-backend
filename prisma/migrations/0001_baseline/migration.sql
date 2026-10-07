-- Baseline migration: the Watts Up Meter schema as defined by the original
-- Supabase migrations (5 files, 2026-08-13 .. 2026-08-24), plus a `users`
-- table that replaces Supabase's `auth.users`.
--
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in).
--
-- Seed rows (appliance catalogue, notification templates) are NOT inserted
-- here; run `npm run prisma:seed` on a fresh database. Keeping seed data out
-- of the migration lets an existing Supabase database be imported without
-- primary-key / unique-name collisions.


-- CreateEnum
CREATE TYPE "app_role" AS ENUM ('admin', 'customer');

-- CreateEnum
CREATE TYPE "meter_status" AS ENUM ('ACTIVE', 'LOW', 'CRITICAL', 'URGENT', 'DEPLETED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "gsm_status" AS ENUM ('CONNECTED', 'WEAK', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "usage_profile" AS ENUM ('CONSTANT', 'CYCLIC', 'INTERMITTENT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL DEFAULT 'Customer',
    "email" TEXT,
    "phone_number" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role" "app_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "meter_number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL DEFAULT 'Demo Customer',
    "phone_number" TEXT,
    "initial_balance" DECIMAL(12,4) NOT NULL DEFAULT 50,
    "balance_kwh" DECIMAL(12,4) NOT NULL DEFAULT 50,
    "total_consumed_kwh" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "voltage" DECIMAL(8,2) NOT NULL DEFAULT 230,
    "current_amps" DECIMAL(8,3) NOT NULL DEFAULT 0,
    "power_watts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "frequency_hz" DECIMAL(6,3) NOT NULL DEFAULT 50,
    "power_factor" DECIMAL(4,3) NOT NULL DEFAULT 0.95,
    "status" "meter_status" NOT NULL DEFAULT 'ACTIVE',
    "gsm" "gsm_status" NOT NULL DEFAULT 'CONNECTED',
    "signal_dbm" INTEGER NOT NULL DEFAULT -72,
    "tariff_per_kwh" DECIMAL(10,2) NOT NULL DEFAULT 100,
    "low_threshold" DECIMAL(10,2) NOT NULL DEFAULT 15,
    "critical_threshold" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "urgent_threshold" DECIMAL(10,2) NOT NULL DEFAULT 5,
    "notified_low" BOOLEAN NOT NULL DEFAULT false,
    "notified_critical" BOOLEAN NOT NULL DEFAULT false,
    "notified_urgent" BOOLEAN NOT NULL DEFAULT false,
    "notified_depleted" BOOLEAN NOT NULL DEFAULT false,
    "simulation_running" BOOLEAN NOT NULL DEFAULT false,
    "simulation_speed" INTEGER NOT NULL DEFAULT 60,
    "simulated_seconds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "last_tick_at" TIMESTAMPTZ(6),
    "last_reading_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appliances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'plug',
    "rated_power" DECIMAL(10,2) NOT NULL,
    "idle_power" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "voltage" DECIMAL(8,2) NOT NULL DEFAULT 230,
    "power_factor" DECIMAL(4,3) NOT NULL DEFAULT 0.95,
    "usage_profile" "usage_profile" NOT NULL DEFAULT 'CONSTANT',
    "duty_cycle" DECIMAL(4,3) NOT NULL DEFAULT 1,
    "cycle_seconds" INTEGER NOT NULL DEFAULT 600,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appliances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_appliances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meter_id" UUID NOT NULL,
    "appliance_id" UUID NOT NULL,
    "is_on" BOOLEAN NOT NULL DEFAULT true,
    "cycle_phase" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "energy_kwh" DECIMAL(12,5) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_appliances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" BIGSERIAL NOT NULL,
    "meter_id" UUID NOT NULL,
    "voltage" DECIMAL(8,2) NOT NULL,
    "current_amps" DECIMAL(8,3) NOT NULL,
    "power_watts" DECIMAL(10,2) NOT NULL,
    "frequency_hz" DECIMAL(6,3) NOT NULL,
    "power_factor" DECIMAL(4,3) NOT NULL,
    "energy_kwh" DECIMAL(12,5) NOT NULL,
    "balance_kwh" DECIMAL(12,4) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recharges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meter_id" UUID NOT NULL,
    "amount_kwh" DECIMAL(12,4) NOT NULL,
    "previous_balance" DECIMAL(12,4) NOT NULL,
    "new_balance" DECIMAL(12,4) NOT NULL,
    "reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meter_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "threshold" DECIMAL(10,2),
    "balance_kwh" DECIMAL(12,4),
    "message" TEXT NOT NULL,
    "sms_status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meter_id" UUID,
    "user_id" UUID,
    "alert_id" UUID,
    "phone_number" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'africastalking',
    "provider_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "failure_reason" TEXT,
    "cost" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6),

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ussd_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "service_code" TEXT,
    "meter_id" UUID,
    "user_id" UUID,
    "request_text" TEXT,
    "response_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "ussd_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "description" TEXT,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_configurations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meter_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "items" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "response_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_key" ON "user_roles"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "meters_meter_number_key" ON "meters"("meter_number");

-- CreateIndex
CREATE INDEX "idx_meters_user" ON "meters"("user_id");

-- CreateIndex
CREATE INDEX "idx_meters_phone" ON "meters"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "appliances_name_key" ON "appliances"("name");

-- CreateIndex
CREATE INDEX "idx_meter_appliances_meter" ON "meter_appliances"("meter_id");

-- CreateIndex
CREATE INDEX "idx_readings_meter_time" ON "meter_readings"("meter_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "idx_recharges_meter" ON "recharges"("meter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_alerts_meter" ON "alerts"("meter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_sms_logs_meter" ON "sms_logs"("meter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_sms_logs_provider_msg" ON "sms_logs"("provider_message_id");

-- CreateIndex
CREATE INDEX "idx_ussd_session" ON "ussd_sessions"("session_id");

-- CreateIndex
CREATE INDEX "idx_ussd_phone" ON "ussd_sessions"("phone_number", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ussd_sessions_dedupe" ON "ussd_sessions"("session_id", "request_text");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_key" ON "notification_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_dedupe" ON "webhook_events"("provider", "event_type", "external_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meter_appliances" ADD CONSTRAINT "meter_appliances_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meter_appliances" ADD CONSTRAINT "meter_appliances_appliance_id_fkey" FOREIGN KEY ("appliance_id") REFERENCES "appliances"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recharges" ADD CONSTRAINT "recharges_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ussd_sessions" ADD CONSTRAINT "ussd_sessions_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meter_configurations" ADD CONSTRAINT "meter_configurations_meter_id_fkey" FOREIGN KEY ("meter_id") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Indexes Prisma cannot express in schema.prisma (kept from migration
-- 20260819224547): one default configuration per meter, and configuration
-- names unique per meter regardless of case.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "meter_configurations_one_default" ON "meter_configurations" ("meter_id") WHERE "is_default";
CREATE UNIQUE INDEX "meter_configurations_name_unique" ON "meter_configurations" ("meter_id", lower("name"));
