import { RateLimitError } from "./errors.js";
import type * as types from "./types.js";

/** Longest accepted limiter key. */
export const MAX_KEY_LENGTH = 512;
/** Longest accepted key prefix. */
export const MAX_PREFIX_LENGTH = 64;
/** Longest stored limiter state that is parsed. */
export const MAX_STATE_LENGTH = 256;
/** Largest accepted integer configuration value. */
export const MAX_INT_CONFIG = 2_147_483_647;
/** Largest time to live requested from a store. */
export const MAX_TTL_MS = 2_147_483_647;
/** Tolerance for floating point comparisons. */
export const EPSILON = 1e-9;

const MAX_RATE = 1e9;

/** Parsed limiter state. */
export type State = Record<string, unknown>;

function badKey(): RateLimitError {
  return new RateLimitError("KEY_INVALID", "key must be 1 to 512 characters");
}

function badPrefix(): RateLimitError {
  const message = "prefix must be 1 to 64 characters";
  return new RateLimitError("INVALID_CONFIG", message);
}

/** Throws INVALID_CONFIG unless `opts` is an object. */
export function checkOptions(opts: unknown): void {
  if (typeof opts !== "object" || opts === null) {
    throw new RateLimitError("INVALID_CONFIG", "options must be an object");
  }
}

/** Throws KEY_INVALID unless `key` is a string of 1..512 characters. */
export function checkKey(key: unknown): void {
  if (typeof key !== "string") {
    throw badKey();
  }
  if (key.length < 1 || key.length > MAX_KEY_LENGTH) {
    throw badKey();
  }
}

/** Returns `cost` if it is an integer in 1..max, else throws INVALID_COST. */
export function checkCost(cost: unknown, max: number): number {
  if (typeof cost === "number" && Number.isInteger(cost)) {
    if (cost >= 1 && cost <= max) {
      return cost;
    }
  }
  const message = `cost must be an integer from 1 to ${max}`;
  throw new RateLimitError("INVALID_COST", message);
}

/** Returns `value` if it is an integer in 1..MAX_INT_CONFIG. */
export function positiveInt(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 1 && value <= MAX_INT_CONFIG) {
      return value;
    }
  }
  const message = `${name} must be an integer from 1 to ${MAX_INT_CONFIG}`;
  throw new RateLimitError("INVALID_CONFIG", message);
}

/** Returns `value` if it is a finite number in (0, 1e9]. */
export function positiveRate(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value <= MAX_RATE) {
      return value;
    }
  }
  const message = `${name} must be a positive number`;
  throw new RateLimitError("INVALID_CONFIG", message);
}

/** Returns the injected clock or `Date.now`. */
export function resolveClock(clock: types.Clock | undefined): types.Clock {
  if (clock === undefined) {
    return Date.now;
  }
  if (typeof clock !== "function") {
    throw new RateLimitError("INVALID_CONFIG", "clock must be a function");
  }
  return clock;
}

/** Reads the clock and rejects non-finite readings. */
export function readClock(clock: types.Clock): number {
  const now = clock();
  if (typeof now !== "number" || !Number.isFinite(now)) {
    const message = "clock must return a finite number";
    throw new RateLimitError("INVALID_CONFIG", message);
  }
  return now;
}

/** Returns a validated prefix or the fallback. */
export function resolvePrefix(prefix: unknown, fallback: string): string {
  if (prefix === undefined) {
    return fallback;
  }
  if (typeof prefix !== "string") {
    throw badPrefix();
  }
  if (prefix.length < 1 || prefix.length > MAX_PREFIX_LENGTH) {
    throw badPrefix();
  }
  return prefix;
}

/** Rounds a duration up to whole milliseconds, tolerating float noise. */
export function ceilMs(value: number): number {
  return Math.max(0, Math.ceil(value - EPSILON));
}

/** Rounds a count down to a whole number, tolerating float noise. */
export function floorCount(value: number): number {
  return Math.max(0, Math.floor(value + EPSILON));
}

/** Parses stored state; anything oversized or malformed yields undefined. */
export function parseState(text: string | undefined): State | undefined {
  if (text === undefined || text.length > MAX_STATE_LENGTH) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as State;
}

/** Returns `value` when it is a finite number. */
export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

/** Unwraps a value captured by an update closure. */
export function applied<T>(value: T | undefined): T {
  if (value === undefined) {
    const message = "store did not apply the update";
    throw new RateLimitError("INVALID_CONFIG", message);
  }
  return value;
}

/**
 * Applies `fn` to the stored value atomically when the store supports
 * `update`, otherwise with a non-atomic get followed by set.
 */
export async function mutate(
  store: types.RateLimitStore,
  key: string,
  fn: types.Updater,
  ttlMs: number,
): Promise<void> {
  if (store.update !== undefined) {
    await store.update(key, fn, ttlMs);
    return;
  }
  const current = await store.get(key);
  await store.set(key, fn(current), ttlMs);
}
