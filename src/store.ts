import { RateLimitError } from "./errors.js";
import * as util from "./internal.js";
import type * as types from "./types.js";

const DEFAULT_MAX_KEYS = 10_000;
const MAX_STORE_KEY_LENGTH = 1024;
const MAX_STORE_VALUE_LENGTH = 4096;

interface Entry {
  readonly value: string;
  readonly expiresAt: number;
}

function checkWrite(key: unknown, value: unknown, ttlMs: unknown): void {
  if (typeof key !== "string") {
    throw new RateLimitError("KEY_INVALID", "store key must be a string");
  }
  if (key.length < 1 || key.length > MAX_STORE_KEY_LENGTH) {
    throw new RateLimitError("KEY_INVALID", "store key length is invalid");
  }
  if (typeof value !== "string" || value.length > MAX_STORE_VALUE_LENGTH) {
    throw new RateLimitError("INVALID_CONFIG", "store value is too large");
  }
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RateLimitError("INVALID_CONFIG", "ttlMs must be positive");
  }
}

/**
 * Bounded in-memory store. Updates are synchronous, therefore atomic within a
 * process. At `maxKeys` it first drops expired keys, then the least recently
 * updated key (Map insertion order, re-inserted on every write).
 */
export class MemoryStore implements types.RateLimitStore {
  readonly #entries = new Map<string, Entry>();
  readonly #clock: types.Clock;
  readonly #maxKeys: number;

  /**
   * @param opts - Optional clock and `maxKeys` (default 10_000).
   * @throws {RateLimitError} INVALID_CONFIG for a bad clock or maxKeys.
   */
  constructor(opts: types.MemoryStoreOptions = {}) {
    util.checkOptions(opts);
    this.#clock = util.resolveClock(opts.clock);
    const max = opts.maxKeys ?? DEFAULT_MAX_KEYS;
    this.#maxKeys = util.positiveInt(max, "maxKeys");
  }

  /** Number of stored entries, including expired ones not yet swept. */
  get size(): number {
    return this.#entries.size;
  }

  /** Returns the live value of `key`, or undefined. */
  async get(key: string): Promise<string | undefined> {
    return this.#read(key);
  }

  /** Stores `value` for `ttlMs` milliseconds. */
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.#write(key, value, ttlMs);
  }

  /** Atomically replaces the value of `key` with `fn(current)`. */
  async update(key: string, fn: types.Updater, ttlMs: number): Promise<string> {
    const next = fn(this.#read(key));
    this.#write(key, next, ttlMs);
    return next;
  }

  #read(key: string): string | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= util.readClock(this.#clock)) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  #write(key: string, value: string, ttlMs: number): void {
    checkWrite(key, value, ttlMs);
    const now = util.readClock(this.#clock);
    this.#entries.delete(key);
    if (this.#entries.size >= this.#maxKeys) {
      this.#evict(now);
    }
    this.#entries.set(key, { value, expiresAt: now + ttlMs });
  }

  #evict(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
    if (this.#entries.size >= this.#maxKeys) {
      const oldest = this.#entries.keys().next();
      if (oldest.done !== true) {
        this.#entries.delete(oldest.value);
      }
    }
  }
}
