/**
 * Seeds reference data: the appliance catalogue and notification templates.
 *
 * These are the exact rows the original Supabase migrations inserted
 * (20260813202833 and 20260819224547). The seed is idempotent and never
 * overwrites existing rows: an appliance or template that already exists
 * (by name / key) is left as the administrator last saved it.
 *
 * Usage: npm run prisma:seed   (also run by `prisma migrate reset` in dev only)
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UsageProfile } from "@prisma/client";

const appliances: Array<{
  name: string;
  category: string;
  icon: string;
  rated_power: number;
  idle_power: number;
  power_factor: number;
  usage_profile: UsageProfile;
  duty_cycle: number;
  cycle_seconds: number;
}> = [
  {
    name: "LED Bulb",
    category: "Lighting",
    icon: "lightbulb",
    rated_power: 10,
    idle_power: 0,
    power_factor: 0.95,
    usage_profile: "CONSTANT",
    duty_cycle: 1,
    cycle_seconds: 600,
  },
  {
    name: "Ceiling Fan",
    category: "Cooling",
    icon: "fan",
    rated_power: 75,
    idle_power: 0,
    power_factor: 0.9,
    usage_profile: "CONSTANT",
    duty_cycle: 1,
    cycle_seconds: 600,
  },
  {
    name: "Television",
    category: "Entertainment",
    icon: "tv",
    rated_power: 120,
    idle_power: 5,
    power_factor: 0.95,
    usage_profile: "CONSTANT",
    duty_cycle: 1,
    cycle_seconds: 600,
  },
  {
    name: "Refrigerator",
    category: "Kitchen",
    icon: "refrigerator",
    rated_power: 180,
    idle_power: 20,
    power_factor: 0.8,
    usage_profile: "CYCLIC",
    duty_cycle: 0.45,
    cycle_seconds: 900,
  },
  {
    name: "Electric Iron",
    category: "Laundry",
    icon: "shirt",
    rated_power: 1200,
    idle_power: 0,
    power_factor: 0.99,
    usage_profile: "INTERMITTENT",
    duty_cycle: 0.7,
    cycle_seconds: 300,
  },
  {
    name: "Microwave",
    category: "Kitchen",
    icon: "microwave",
    rated_power: 1000,
    idle_power: 3,
    power_factor: 0.9,
    usage_profile: "INTERMITTENT",
    duty_cycle: 0.6,
    cycle_seconds: 180,
  },
  {
    name: "Air Conditioner",
    category: "Cooling",
    icon: "air-vent",
    rated_power: 1500,
    idle_power: 300,
    power_factor: 0.85,
    usage_profile: "CYCLIC",
    duty_cycle: 0.6,
    cycle_seconds: 600,
  },
  {
    name: "Water Heater",
    category: "Utility",
    icon: "droplets",
    rated_power: 3000,
    idle_power: 0,
    power_factor: 0.99,
    usage_profile: "CYCLIC",
    duty_cycle: 0.4,
    cycle_seconds: 900,
  },
  {
    name: "Electric Cooker",
    category: "Kitchen",
    icon: "cooking-pot",
    rated_power: 2000,
    idle_power: 0,
    power_factor: 0.98,
    usage_profile: "INTERMITTENT",
    duty_cycle: 0.75,
    cycle_seconds: 600,
  },
  {
    name: "Laptop",
    category: "Office",
    icon: "laptop",
    rated_power: 65,
    idle_power: 5,
    power_factor: 0.92,
    usage_profile: "CONSTANT",
    duty_cycle: 1,
    cycle_seconds: 600,
  },
];

const templates: Array<{ key: string; body: string; channel?: string; description?: string }> = [
  {
    key: "LOW_BALANCE",
    body: "ENERGY ALERT: Your prepaid meter {{meterNumber}} has {{balance}} kWh remaining. Please recharge your meter to avoid service interruption. Energy Monitoring System",
  },
  {
    key: "CRITICAL_BALANCE",
    body: "CRITICAL ENERGY ALERT: Meter {{meterNumber}} has only {{balance}} kWh left (load {{currentLoad}} kW, approx {{estimatedRemainingTime}} left). Recharge now. Energy Monitoring System",
  },
  {
    key: "URGENT_BALANCE",
    body: "URGENT: Meter {{meterNumber}} balance is {{balance}} kWh. Power will be interrupted shortly. Recharge immediately. Energy Monitoring System",
  },
  {
    key: "METER_DEPLETED",
    body: "METER DEPLETED: Meter {{meterNumber}} has 0.00 kWh remaining and supply has been cut. Recharge to restore power. Energy Monitoring System",
  },
  {
    key: "RECHARGE_SUCCESS",
    body: "RECHARGE SUCCESSFUL: Meter {{meterNumber}} credited. New balance is {{balance}} kWh. Thank you, {{customerName}}. Energy Monitoring System",
  },
  {
    key: "USSD_MENU_HEADER",
    body: "PREPAID ENERGY MONITOR",
    channel: "USSD",
    description: "First line shown on the USSD main menu",
  },
  {
    key: "USSD_NOT_REGISTERED",
    body: "This phone number is not registered with the Energy Monitoring System.",
    channel: "USSD",
    description: "Shown when the caller MSISDN has no meter",
  },
];

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const appliancesResult = await prisma.appliance.createMany({
      data: appliances,
      skipDuplicates: true,
    });
    const templatesResult = await prisma.notificationTemplate.createMany({
      data: templates.map((t) => ({ channel: "SMS", ...t })),
      skipDuplicates: true,
    });
    console.log(
      `Seed complete: ${appliancesResult.count} appliance(s) and ${templatesResult.count} template(s) added; existing rows untouched.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
