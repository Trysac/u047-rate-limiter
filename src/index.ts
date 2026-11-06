/**
 * Public entry point of @trysac/rate-limiter.
 *
 * Token bucket and sliding window counter rate limiters with an injectable
 * clock, a pluggable store, a bounded in-memory store and standard 429 headers.
 */

export { RateLimitError } from "./errors.js";
export { createRateLimitMiddleware, headers } from "./http.js";
export { SlidingWindow } from "./sliding-window.js";
export { MemoryStore } from "./store.js";
export { TokenBucket } from "./token-bucket.js";
export type {
  Clock,
  EventHandler,
  HeaderMap,
  Limiter,
  MemoryStoreOptions,
  Middleware,
  MiddlewareOptions,
  RateLimitCode,
  RateLimitEvent,
  RateLimitResult,
  RateLimitStore,
  SlidingWindowOptions,
  TokenBucketOptions,
  Updater,
} from "./types.js";
