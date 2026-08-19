import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, hashIp, resetRateLimits } from "./ratelimit";

beforeEach(() => resetRateLimits());

describe("token bucket", () => {
  it("allows bursts up to capacity then rejects", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit("auth", "client-a", t0)).toBe(true);
    }
    expect(checkRateLimit("auth", "client-a", t0)).toBe(false);
  });

  it("refills over time", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) checkRateLimit("auth", "client-b", t0);
    expect(checkRateLimit("auth", "client-b", t0)).toBe(false);
    // 0.5 tokens/sec → one token every 2s
    expect(checkRateLimit("auth", "client-b", t0 + 2_100)).toBe(true);
  });

  it("keys are independent", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) checkRateLimit("auth", "client-c", t0);
    expect(checkRateLimit("auth", "client-c", t0)).toBe(false);
    expect(checkRateLimit("auth", "client-d", t0)).toBe(true);
  });
});

describe("IP hashing (no raw IPs stored)", () => {
  it("is stable within a day and rotates across days", () => {
    const day1 = new Date("2026-08-19T10:00:00Z");
    const day1later = new Date("2026-08-19T23:00:00Z");
    const day2 = new Date("2026-08-20T01:00:00Z");
    expect(hashIp("203.0.113.9", day1)).toBe(hashIp("203.0.113.9", day1later));
    expect(hashIp("203.0.113.9", day1)).not.toBe(hashIp("203.0.113.9", day2));
  });

  it("never contains the raw IP", () => {
    expect(hashIp("203.0.113.9")).not.toContain("203.0.113.9");
  });
});
