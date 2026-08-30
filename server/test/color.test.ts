import { describe, it, expect } from "vitest";
import { hexToHue, averageHue, randomHueNear, randomHue, hueForHexes } from "../src/lib/color.js";

describe("color lib", () => {
  it("hexToHue converts known colors", () => {
    expect(hexToHue("#ff0000")).toBe(0);
    expect(hexToHue("#00ff00")).toBe(120);
    expect(hexToHue("#0000ff")).toBe(240);
    expect(hexToHue("#2d8c4a")).toBeGreaterThanOrEqual(90);
    expect(hexToHue("#2d8c4a")).toBeLessThanOrEqual(180);
    expect(hexToHue("rgb-invalid")).toBe(0);
  });

  it("averageHue handles wrap-around (350 and 10 average to 0, not 180)", () => {
    expect(averageHue([350, 10])).toBeCloseTo(0, 0);
    expect(averageHue([0, 90])).toBeGreaterThan(0);
    expect(averageHue([0, 90])).toBeLessThan(90);
  });

  it("randomHueNear keeps hue within the jitter range", () => {
    for (let i = 0; i < 100; i++) {
      const h = randomHueNear(138, 25);
      expect(h).toBeGreaterThanOrEqual(113);
      expect(h).toBeLessThanOrEqual(163);
    }
    // wrap-around
    const nearZero = randomHueNear(0, 10);
    expect(nearZero >= 350 || nearZero <= 10).toBe(true);
  });

  it("randomHue returns values in [0, 360)", () => {
    for (let i = 0; i < 100; i++) {
      const h = randomHue();
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("hueForHexes without colors returns a random hue", () => {
    const h = hueForHexes([], 0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it("hueForHexes derives a green tone from green categories", () => {
    for (let i = 0; i < 50; i++) {
      const h = hueForHexes(["#2d8c4a"], 25);
      expect(h).toBeGreaterThanOrEqual(90);
      expect(h).toBeLessThanOrEqual(180);
    }
  });
});
