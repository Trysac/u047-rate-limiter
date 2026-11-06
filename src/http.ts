import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimitError } from "./errors.js";
import type * as types from "./types.js";

const PROBLEM_TYPE = "application/problem+json";

const PROBLEM_BODY = JSON.stringify({
  type: "about:blank",
  title: "Too Many Requests",
  status: 429,
});

function secondsOf(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return String(Math.ceil(safe / 1000));
}

function emit(handler: types.EventHandler | undefined, type: "limited" | "store_error"): void {
  if (handler === undefined) {
    return;
  }
  try {
    handler({ type });
  } catch {
    // A failing observer must never change how a request is handled.
  }
}

/**
 * Builds the `RateLimit-*` headers of draft-ietf-httpapi-ratelimit-headers-06
 * and, for rejected results, `Retry-After` in delay-seconds (RFC 9110 10.2.3).
 *
 * @param result - A limiter result.
 * @returns Header names mapped to string values.
 */
export function headers(result: types.RateLimitResult): types.HeaderMap {
  const out: types.HeaderMap = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": secondsOf(result.resetMs),
  };
  if (!result.allowed) {
    out["Retry-After"] = secondsOf(result.retryAfterMs);
  }
  return out;
}

/**
 * Creates Connect-style middleware for Node's `http` objects.
 *
 * Limited requests get a 429 `application/problem+json` response with the
 * rate limit headers and `next` is not called. Store failures are rethrown
 * unless `failOpen` is true; `RateLimitError`s (for example an invalid key)
 * are always rethrown so they can never become a bypass.
 *
 * @param limiter - A `TokenBucket`, `SlidingWindow` or any `Limiter`.
 * @param opts - Key derivation, fail-open flag and event callback.
 * @throws {RateLimitError} INVALID_CONFIG for a missing limiter or keyOf.
 */
export function createRateLimitMiddleware(
  limiter: types.Limiter,
  opts: types.MiddlewareOptions,
): types.Middleware {
  const hasLimiter = typeof limiter?.consume === "function";
  const hasKey = typeof opts?.keyOf === "function";
  if (!hasLimiter || !hasKey) {
    const message = "a limiter and opts.keyOf are required";
    throw new RateLimitError("INVALID_CONFIG", message);
  }
  const failOpen = opts.failOpen === true;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const key = opts.keyOf(req);
    let result: types.RateLimitResult;
    try {
      result = await limiter.consume(key);
    } catch (error) {
      if (failOpen && !(error instanceof RateLimitError)) {
        emit(opts.onEvent, "store_error");
        next();
        return;
      }
      throw error;
    }
    if (result.allowed) {
      next();
      return;
    }
    emit(opts.onEvent, "limited");
    res.statusCode = 429;
    res.setHeader("Content-Type", PROBLEM_TYPE);
    for (const [name, value] of Object.entries(headers(result))) {
      res.setHeader(name, value);
    }
    res.end(PROBLEM_BODY);
  };
}
