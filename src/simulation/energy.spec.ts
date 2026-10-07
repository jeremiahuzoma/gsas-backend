import {
  aggregatePowerFactor,
  appliancePower,
  calculateCurrent,
  calculateEnergyKwh,
  detectThresholdCrossing,
  estimatedRemainingSeconds,
  formatDuration,
  renderTemplate,
  resetFlagsForBalance,
  simulateFrequency,
  simulateVoltage,
  statusForBalance,
  visualState,
} from "./energy";

const cfg = { low: 15, critical: 10, urgent: 5 };
const noFlags = {
  notifiedLow: false,
  notifiedCritical: false,
  notifiedUrgent: false,
  notifiedDepleted: false,
};

describe("energy calculations", () => {
  it("E = P × t (kWh)", () => {
    expect(calculateEnergyKwh(1000, 3600)).toBe(1);
    expect(calculateEnergyKwh(1500, 1800)).toBeCloseTo(0.75);
    expect(calculateEnergyKwh(0, 3600)).toBe(0);
  });

  it("I = P / (V × PF), zero for non-positive inputs", () => {
    expect(calculateCurrent(2300, 230, 1)).toBe(10);
    expect(calculateCurrent(1000, 230, 0.85)).toBeCloseTo(5.115, 3);
    expect(calculateCurrent(0, 230, 0.9)).toBe(0);
    expect(calculateCurrent(100, 0, 0.9)).toBe(0);
  });

  it("aggregate power factor is power-weighted and clamped", () => {
    expect(aggregatePowerFactor([])).toBe(0.95);
    expect(
      aggregatePowerFactor([
        { power: 100, powerFactor: 0.8 },
        { power: 300, powerFactor: 1 },
      ]),
    ).toBeCloseTo(0.95);
    expect(aggregatePowerFactor([{ power: 100, powerFactor: 0.2 }])).toBe(0.5);
  });

  it("appliance power follows usage profile and duty cycle", () => {
    const fridge = {
      ratedPower: 180,
      idlePower: 20,
      powerFactor: 0.8,
      usageProfile: "CYCLIC" as const,
      dutyCycle: 0.45,
      cycleSeconds: 900,
    };
    expect(appliancePower(fridge, false, 0)).toBe(0);
    expect(appliancePower(fridge, true, 0)).toBe(180); // compressor on
    expect(appliancePower(fridge, true, 404)).toBe(180);
    expect(appliancePower(fridge, true, 405)).toBe(20); // idle part of the cycle
    expect(appliancePower(fridge, true, 900 + 10)).toBe(180); // wraps around
    const bulb = { ...fridge, ratedPower: 10, usageProfile: "CONSTANT" as const };
    expect(appliancePower(bulb, true, 12345)).toBe(10);
  });

  it("voltage and frequency stay within realistic bounds", () => {
    for (let i = 0; i < 500; i += 1) {
      const v = simulateVoltage(230, Math.random() * 10);
      expect(v).toBeGreaterThanOrEqual(218);
      expect(v).toBeLessThanOrEqual(238);
      const f = simulateFrequency();
      expect(f).toBeGreaterThanOrEqual(49.96);
      expect(f).toBeLessThanOrEqual(50.04);
    }
  });

  it("remaining time = balance / load", () => {
    expect(estimatedRemainingSeconds(10, 0)).toBeNull();
    expect(estimatedRemainingSeconds(1, 1000)).toBe(3600);
    expect(formatDuration(null)).toBe("∞");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(7 * 3600 + 42 * 60)).toBe("7h 42m");
    expect(formatDuration(500 * 3600)).toBe("99h+");
  });

  it("status and visual state follow the thresholds", () => {
    expect(statusForBalance(20, cfg)).toBe("ACTIVE");
    expect(statusForBalance(15, cfg)).toBe("LOW");
    expect(statusForBalance(9.99, cfg)).toBe("CRITICAL");
    expect(statusForBalance(5, cfg)).toBe("URGENT");
    expect(statusForBalance(0, cfg)).toBe("DEPLETED");
    expect(visualState(55)).toBe("NORMAL");
    expect(visualState(16)).toBe("LOW");
    expect(visualState(0)).toBe("DEPLETED");
  });

  it("renders template placeholders, blanking unknown ones", () => {
    expect(
      renderTemplate("Meter {{meterNumber}} has {{ balance }} kWh{{nope}}", {
        meterNumber: "4501",
        balance: "15.00",
      }),
    ).toBe("Meter 4501 has 15.00 kWh");
  });
});

describe("threshold detection (idempotent)", () => {
  it("fires each threshold once, most severe first", () => {
    expect(detectThresholdCrossing(15.01, cfg, noFlags)).toBeNull();
    expect(detectThresholdCrossing(15, cfg, noFlags)).toEqual({
      kind: "LOW_BALANCE",
      threshold: 15,
    });
    expect(detectThresholdCrossing(14.9, cfg, { ...noFlags, notifiedLow: true })).toBeNull();
    expect(detectThresholdCrossing(4, cfg, noFlags)).toEqual({
      kind: "URGENT_BALANCE",
      threshold: 5,
    });
    expect(detectThresholdCrossing(0, cfg, noFlags)).toEqual({
      kind: "METER_DEPLETED",
      threshold: 0,
    });
    expect(detectThresholdCrossing(0, cfg, { ...noFlags, notifiedDepleted: true })).toBeNull();
  });

  it("recharge resets only the flags above the new balance", () => {
    expect(resetFlagsForBalance(50, cfg)).toEqual(noFlags);
    expect(resetFlagsForBalance(12, cfg)).toEqual({ ...noFlags, notifiedLow: true });
    expect(resetFlagsForBalance(0, cfg)).toEqual({
      notifiedLow: true,
      notifiedCritical: true,
      notifiedUrgent: true,
      notifiedDepleted: true,
    });
  });
});
