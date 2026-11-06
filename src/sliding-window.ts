import * as util from "./internal.js";
import { MemoryStore } from "./store.js";
import type * as types from "./types.js";

interface WindowState {
  readonly start: number;
  readonly current: number;
  readonly previous: number;
}

interface Step {
  readonly state: string;
  readonly result: types.RateLimitResult;
}

function readWindow(text: string | undefined): WindowState | undefined {
  const obj = util.parseState(text);
  if (obj === undefined) {
    return undefined;
  }
  const start = util.finiteNumber(obj.s);
  const current = util.finiteNumber(obj.c);
  const previous = util.finiteNumber(obj.p);
  if (start === undefined || current === undefined) {
    return undefined;
  }
  if (previous === undefined || current < 0 || previous < 0) {
    return undefined;
  }
  return { start, current, previous };
}

/**
 * Sliding window counter: the estimate is
 * `previous * (windowMs - elapsed) / windowMs + current`, where windows start
 * at `floor(now / windowMs) * windowMs`. Rejected requests are never counted.
 * A clock that moves backwards keeps the stored window, so it never grants
 * a fresh quota.
 */
export class SlidingWindow {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #ttlMs: number;
  readonly #store: types.RateLimitStore;
  readonly #clock: types.Clock;
  readonly #prefix: string;

  /**
   * @param opts - Limit, window length and optional store, clock, prefix.
   * @throws {RateLimitError} INVALID_CONFIG for invalid options.
   */
  constructor(opts: types.SlidingWindowOptions) {
    util.checkOptions(opts);
    this.#limit = util.positiveInt(opts.limit, "limit");
    this.#windowMs = util.positiveInt(opts.windowMs, "windowMs");
    this.#clock = util.resolveClock(opts.clock);
    this.#store = opts.store ?? new MemoryStore({ clock: this.#clock });
    this.#prefix = util.resolvePrefix(opts.prefix, "sw");
    this.#ttlMs = Math.min(util.MAX_TTL_MS, this.#windowMs * 2);
  }

  /**
   * Counts `cost` units against `key` when the estimate allows it.
   *
   * @param key - Limiter key of 1..512 characters.
   * @param cost - Integer from 1 to limit, default 1.
   * @returns The decision with remaining quota and timing hints.
   * @throws {RateLimitError} KEY_INVALID, INVALID_COST or INVALID_CONFIG.
   */
  async consume(key: string, cost = 1): Promise<types.RateLimitResult> {
    util.checkKey(key);
    const n = util.checkCost(cost, this.#limit);
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
    const win = this.#windowMs;
    const limit = this.#limit;
    const aligned = Math.floor(now / win) * win;
    const old = readWindow(text);
    let start = aligned;
    let cur = 0;
    let prev = 0;
    if (old !== undefined) {
      start = Math.max(aligned, old.start);
      const diff = start - old.start;
      if (diff === 0) {
        cur = old.current;
        prev = old.previous;
      } else if (diff < 2 * win) {
        prev = old.current;
      }
    }
    const t = Math.max(0, now - start);
    const estimate = (prev * (win - t)) / win + cur;
    const allowed = estimate + cost <= limit + util.EPSILON;
    const added = allowed ? cost : 0;
    const nextCur = cur + added;
    const used = estimate + added;
    let resetMs = 0;
    if (nextCur > 0) {
      resetMs = 2 * win - t;
    } else if (prev > 0) {
      resetMs = win - t;
    }
    const retry = allowed ? 0 : this.#retry(prev, cur, t, cost);
    return {
      state: JSON.stringify({ s: start, c: nextCur, p: prev }),
      result: {
        allowed,
        limit,
        remaining: util.floorCount(limit - used),
        resetMs: util.ceilMs(resetMs),
        retryAfterMs: retry,
      },
    };
  }

  #retry(prev: number, cur: number, t: number, cost: number): number {
    const win = this.#windowMs;
    const limit = this.#limit;
    let wait: number;
    if (cur + cost <= limit) {
      const tStar = win - ((limit - cur - cost) * win) / prev;
      wait = tStar - t;
    } else {
      const tStar = win - ((limit - cost) * win) / cur;
      wait = win - t + tStar;
    }
    return Math.max(1, util.ceilMs(wait));
  }
}
