/**
 * In-memory token buckets keyed by (route class, client identity or IP hash).
 * Sufficient for one box (N8E-API-SPEC §2 step 4). Raw IPs are never stored —
 * keys use a salted, daily-rotating hash (CLAUDE.md rule 9).
 */
import { createHash } from "node:crypto";

type Bucket = { tokens: number; lastRefill: number };

export type RateClass = "public" | "auth" | "admin";

const LIMITS: Record<RateClass, { capacity: number; refillPerSec: number }> = {
  public: { capacity: 60, refillPerSec: 1 }, // 60 burst, 60/min sustained
  auth: { capacity: 30, refillPerSec: 0.5 }, // login endpoints: 30/min burst
  admin: { capacity: 240, refillPerSec: 4 },
};

const buckets = new Map<string, Bucket>();

export function hashIp(ip: string, now = new Date()): string {
  const salt = process.env.IP_HASH_SALT ?? "n8e-dev-salt";
  const day = now.toISOString().slice(0, 10); // daily rotation
  return createHash("sha256").update(`${salt}:${day}:${ip}`).digest("hex").slice(0, 24);
}

export function checkRateLimit(
  routeClass: RateClass,
  clientKey: string,
  nowMs = Date.now(),
): boolean {
  const { capacity, refillPerSec } = LIMITS[routeClass];
  const key = `${routeClass}:${clientKey}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: nowMs };
    buckets.set(key, bucket);
  }
  const elapsed = (nowMs - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec);
  bucket.lastRefill = nowMs;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Test hook — clears all buckets. */
export function resetRateLimits() {
  buckets.clear();
}
