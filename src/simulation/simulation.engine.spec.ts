import { Prisma } from "@prisma/client";

import { computeTick, TICK_CAP_SECONDS } from "./simulation.engine";
import type { ApplianceLink, MeterRow } from "./simulation.types";

const D = (v: number) => new Prisma.Decimal(v);
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

function meter(overrides: Partial<MeterRow> = {}): MeterRow {
  return {
    id: "m1",
    user_id: "u1",
    meter_number: "450100000001",
    customer_name: "Demo",
    phone_number: "+2348012345678",
    initial_balance: D(50),
    balance_kwh: D(20),
    total_consumed_kwh: D(0),
    voltage: D(230),
    current_amps: D(0),
    power_watts: D(0),
    frequency_hz: D(50),
    power_factor: D(0.95),
    status: "ACTIVE",
    gsm: "CONNECTED",
    signal_dbm: -72,
    tariff_per_kwh: D(100),
    low_threshold: D(15),
    critical_threshold: D(10),
    urgent_threshold: D(5),
    notified_low: false,
    notified_critical: false,
    notified_urgent: false,
    notified_depleted: false,
    simulation_running: true,
    simulation_speed: 60,
    simulated_seconds: D(0),
    last_tick_at: new Date(NOW - 1000),
    last_reading_at: null,
    created_at: new Date(NOW),
    updated_at: new Date(NOW),
    ...overrides,
  };
}

function link(
  name: string,
  ratedPower: number,
  isOn = true,
  extra: Partial<ApplianceLink["appliance"] & object> = {},
): ApplianceLink {
  return {
    id: `link-${name}`,
    meter_id: "m1",
    appliance_id: `app-${name}`,
    is_on: isOn,
    cycle_phase: D(0),
    energy_kwh: D(0),
    created_at: new Date(NOW),
    appliance: {
      id: `app-${name}`,
      name,
      category: "Test",
      icon: "plug",
      rated_power: D(ratedPower),
      idle_power: D(0),
      voltage: D(230),
      power_factor: D(1),
      usage_profile: "CONSTANT",
      duty_cycle: D(1),
      cycle_seconds: 600,
      created_at: new Date(NOW),
      ...extra,
    },
  };
}

const opts = { now: NOW, readingIntervalMs: 5000 };

describe("computeTick", () => {
  beforeEach(() => jest.spyOn(Math, "random").mockReturnValue(0.5)); // no voltage/frequency noise
  afterEach(() => jest.restoreAllMocks());

  it("deducts P × simulated time from the balance", () => {
    // 3600 W for 1 real second at 60× = 60 simulated seconds = 0.06 kWh
    const r = computeTick(meter(), [link("Heater", 3600)], opts);
    expect(r.meterUpdate.balance_kwh).toBeCloseTo(19.94, 4);
    expect(r.meterUpdate.total_consumed_kwh).toBeCloseTo(0.06, 4);
    expect(r.meterUpdate.simulated_seconds).toBe(60);
    expect(r.meterUpdate.power_watts).toBe(3600);
    expect(r.snapshot.balanceKwh).toBeCloseTo(19.94, 4);
    expect(r.applianceUpdates).toEqual([{ id: "link-Heater", cycle_phase: 60, energy_kwh: 0.06 }]);
  });

  it("computes current from P, V and PF", () => {
    const r = computeTick(meter(), [link("Iron", 2300)], opts);
    // 2.3 kW pulls voltage down by 0.805 V (sag = 0.35 V/kW)
    expect(r.meterUpdate.voltage).toBeCloseTo(229.2, 1);
    expect(r.meterUpdate.current_amps).toBeCloseTo(2300 / (229.2 * 1), 1);
    expect(r.meterUpdate.frequency_hz).toBe(50);
  });

  it("does not advance time while paused", () => {
    const r = computeTick(meter({ simulation_running: false }), [link("Heater", 3600)], opts);
    expect(r.meterUpdate.balance_kwh).toBe(20);
    expect(r.applianceUpdates).toEqual([]);
    expect(r.reading).toBeNull();
  });

  it("caps a single tick at 30 real seconds", () => {
    const r = computeTick(
      meter({ last_tick_at: new Date(NOW - 10 * 60_000), simulation_speed: 1 }),
      [link("Heater", 3600)],
      opts,
    );
    expect(r.meterUpdate.simulated_seconds).toBe(TICK_CAP_SECONDS);
  });

  it("never lets the balance go negative and reports depletion once", () => {
    const r = computeTick(meter({ balance_kwh: D(0.01) }), [link("Heater", 3600)], opts);
    expect(r.meterUpdate.balance_kwh).toBe(0);
    expect(r.meterUpdate.status).toBe("DEPLETED");
    expect(r.crossing).toEqual({ kind: "METER_DEPLETED", threshold: 0 });
    expect(r.events.map((e) => e.message)).toContain("Meter DEPLETED - supply interrupted");
    expect(r.meterUpdate).toMatchObject({
      notified_depleted: true,
      notified_urgent: true,
      notified_critical: true,
      notified_low: true,
    });
  });

  it("cuts supply to appliances when the meter is depleted", () => {
    const r = computeTick(
      meter({ balance_kwh: D(0), notified_depleted: true }),
      [link("Heater", 3600)],
      opts,
    );
    expect(r.meterUpdate.power_watts).toBe(0);
    expect(r.snapshot.appliances[0]).toMatchObject({ isOn: true, currentPower: 0 });
    expect(r.crossing).toBeNull();
  });

  it("raises the LOW alert once when crossing 15 kWh", () => {
    const first = computeTick(meter({ balance_kwh: D(15.03) }), [link("Heater", 3600)], opts);
    expect(first.crossing).toEqual({ kind: "LOW_BALANCE", threshold: 15 });
    expect(first.meterUpdate.notified_low).toBe(true);
    const again = computeTick(
      meter({ balance_kwh: D(14.9), notified_low: true }),
      [link("Heater", 3600)],
      opts,
    );
    expect(again.crossing).toBeNull();
  });

  it("persists a reading only when the interval has elapsed", () => {
    const due = computeTick(
      meter({ last_reading_at: new Date(NOW - 5000) }),
      [link("Fan", 75)],
      opts,
    );
    expect(due.reading).not.toBeNull();
    expect(due.meterUpdate.last_reading_at).toEqual(new Date(NOW));
    const notDue = computeTick(
      meter({ last_reading_at: new Date(NOW - 4999) }),
      [link("Fan", 75)],
      opts,
    );
    expect(notDue.reading).toBeNull();
    expect(notDue.meterUpdate.last_reading_at).toBeUndefined();
  });

  it("switched-off appliances draw nothing", () => {
    const r = computeTick(meter(), [link("Heater", 3600, false), link("Bulb", 10)], opts);
    expect(r.meterUpdate.power_watts).toBe(10);
  });

  it("estimated remaining time reflects the new load", () => {
    const r = computeTick(meter({ balance_kwh: D(30) }), [link("Kettle", 2000)], opts);
    // ~29.97 kWh at 2 kW ≈ 14h 59m
    expect(r.snapshot.estimatedRemaining).toBe("14h 59m");
  });
});
