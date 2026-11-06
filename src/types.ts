import type { IncomingMessage, ServerResponse } from "node:http";

/** Millisecond clock; defaults to `Date.now`. Inject a fake in tests. */
export type Clock = () => number;

/** Stable machine-readable codes carried by `RateLimitError`. */
export type RateLimitCode = "INVALID_CONFIG" | "INVALID_COST" | "KEY_INVALID";

/** Header name to value map. */
export type HeaderMap = Record<string, string>;

/** Pure state transition applied by a store: previous value in, next out. */
export type Updater = (current: string | undefined) => string;

/** Outcome of one `consume` call. */
export interface RateLimitResult {
  /** True when the request fits in the limit and was counted. */
  readonly allowed: boolean;
  /** Capacity (token bucket) or limit (sliding window). */
  readonly limit: number;
  /** Whole units still available after this call. */
  readonly remaining: number;
  /** Milliseconds until the limiter is back to its full quota. */
  readonly resetMs: number;
  /** Milliseconds to wait before the same request would be allowed; 0 if allowed. */
  readonly retryAfterMs: number;
}

/** Minimal asynchronous key-value store with expiry. */
export interface RateLimitStore {
  /** Returns the live value of `key`, or undefined. */
  get(key: string): Promise<string | undefined>;
  /** Stores `value` for `ttlMs` milliseconds. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /**
   * Optional atomic read-modify-write. `fn` must be pure because a store may
   * call it more than once; the returned string is the stored value.
   */
  update?(key: string, fn: Updater, ttlMs: number): Promise<string>;
}

/** Options of `MemoryStore`. */
export interface MemoryStoreOptions {
  /** Millisecond clock, defaults to `Date.now`. */
  clock?: Clock;
  /** Maximum number of keys, default 10_000. */
  maxKeys?: number;
}

/** Options of `TokenBucket`. */
export interface TokenBucketOptions {
  /** Bucket size, an integer of at least 1. */
  capacity: number;
  /** Tokens added per second, a positive number (may be fractional). */
  refillPerSecond: number;
  /** State store, defaults to a private `MemoryStore`. */
  store?: RateLimitStore;
  /** Millisecond clock, defaults to `Date.now`. */
  clock?: Clock;
  /** Key prefix, default "tb". */
  prefix?: string;
}

/** Options of `SlidingWindow`. */
export interface SlidingWindowOptions {
  /** Maximum cost per window, an integer of at least 1. */
  limit: number;
  /** Window length in milliseconds, an integer of at least 1. */
  windowMs: number;
  /** State store, defaults to a private `MemoryStore`. */
  store?: RateLimitStore;
  /** Millisecond clock, defaults to `Date.now`. */
  clock?: Clock;
  /** Key prefix, default "sw". */
  prefix?: string;
}

/** Anything that can decide whether a keyed request is allowed. */
export interface Limiter {
  /** Counts `cost` units against `key`. */
  consume(key: string, cost?: number): Promise<RateLimitResult>;
}

/** Event emitted by the middleware. Never contains keys. */
export interface RateLimitEvent {
  readonly type: "limited" | "store_error";
}

/** Callback receiving middleware events. */
export type EventHandler = (event: RateLimitEvent) => void;

/** Options of `createRateLimitMiddleware`. */
export interface MiddlewareOptions {
  /** Derives the limiter key from a request. Must not trust spoofable input. */
  keyOf: (req: IncomingMessage) => string;
  /** When true, a failing store lets the request through. Default false. */
  failOpen?: boolean;
  /** Receives `limited` and `store_error` events. */
  onEvent?: EventHandler;
}

/** Connect-style middleware returned by `createRateLimitMiddleware`. */
export type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => Promise<void>;
