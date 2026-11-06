import * as util from "./internal.js";
import { MemoryStore } from "./store.js";
import type * as types from "./types.js";

interface BucketState {
  readonly tokens: number;
  readonly ts: number;
}

interface Step {
  readonly state: string;
  readonly result: types.RateLimitResult;
}

function readBucket(text: string | undefined): BucketState | undefined {
  const obj = util.parseState(text);
  if (obj === undefined) {
    return undefined;
  }
  const tokens = util.finiteNumber(obj.t);
  const ts = util.finiteNumber(obj.s);
  if (tokens === undefined || ts === undefined) {
    return undefined;
  }
  return { tokens, ts };
}

/**
 * Token bucket with continuous refill:
 * `tokens = min(capacity, tokens + elapsedMs * refillPerSecond / 1000)`.
 * A clock that moves backwards counts as zero elapsed time.
 */
export class TokenBucket {
  readonly #capacity: number;
  readonly #refill: number;
  readonly #ttlMs: number;
  readonly #store: types.RateLimitStore;
  readonly #clock: types.Clock;
  readonly #prefix: string;

  /**
   * @param opts - Capacity, refill rate and optional store, clock, prefix.
   * @throws {RateLimitError} INVALID_CONFIG for invalid options.
   */
  constructor(opts: types.TokenBucketOptions) {
    util.checkOptions(opts);
    this.#capacity = util.positiveInt(opts.capacity, "capacity");
    this.#refill = util.positiveRate(opts.refillPerSecond, "refill");
    this.#clock = util.resolveClock(opts.clock);
    this.#store = opts.store ?? new MemoryStore({ clock: this.#clock });
    this.#prefix = util.resolvePrefix(opts.prefix, "tb");
    const full = Math.ceil((this.#capacity * 1000) / this.#refill);
    this.#ttlMs = Math.min(util.MAX_TTL_MS, Math.max(1, full));
  }

  /**
   * Takes `cost` tokens from `key` when available.
   *
   * @param key - Limiter key of 1..512 characters.
   * @param cost - Integer from 1 to capacity, default 1.
   * @returns The decision with remaining quota and timing hints.
   * @throws {RateLimitError} KEY_INVALID, INVALID_COST or INVALID_CONFIG.
   */
  async consume(key: string, cost = 1): Promise<types.RateLimitResult> {
    util.checkKey(key);
    const n = util.checkCost(cost, this.#capacity);
    const now = util.readClock(this.#clock);
    const out: { result?: types.RateLimitResult } = {};
    const apply = (text: string | undefined): string => {
      const step = this.#step(text, now, n);
      out.result = step.result;
      return step.state;
    };
    const storeKey = `${this.#prefix}:${key}`;
    await util.mutate(this.#store, storeKey, apply, this.#ttlMs);
    return util.applied(out.result);
  }

  #step(text: string | undefined, now: number, cost: number): Step {
    const cap = this.#capacity;
    const prev = readBucket(text);
    let tokens = cap;
    let ts = now;
    if (prev !== undefined) {
      const elapsed = Math.max(0, now - prev.ts);
      const gained = (elapsed * this.#refill) / 1000;
      tokens = Math.min(cap, Math.max(0, prev.tokens) + gained);
      ts = Math.max(now, prev.ts);
    }
    const allowed = tokens + util.EPSILON >= cost;
    if (allowed) {
      tokens = Math.max(0, tokens - cost);
    }
    const toMs = (units: number): number => (units * 1000) / this.#refill;
    const retry = allowed ? 0 : Math.max(1, util.ceilMs(toMs(cost - tokens)));
    return {
      state: JSON.stringify({ t: tokens, s: ts }),
      result: {
        allowed,
        limit: cap,
        remaining: util.floorCount(tokens),
        resetMs: util.ceilMs(toMs(cap - tokens)),
        retryAfterMs: retry,
      },
    };
  }
}
