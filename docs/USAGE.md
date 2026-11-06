# Usage

## Token bucket

```ts
import { TokenBucket, headers } from "@trysac/rate-limiter";

const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 });
const result = await bucket.consume("client-a");
if (!result.allowed) {
  console.log(headers(result), result.retryAfterMs);
}
```

Tokens refill continuously: `tokens = min(capacity, tokens + elapsedMs * refillPerSecond / 1000)`. A request is allowed when `tokens >= cost`. When rejected, `retryAfterMs = ceil((cost - tokens) * 1000 / refillPerSecond)`; `resetMs = ceil((capacity - tokens) * 1000 / refillPerSecond)`.

## Sliding window counter

```ts
import { SlidingWindow } from "@trysac/rate-limiter";

const limiter = new SlidingWindow({ limit: 100, windowMs: 60_000 });
const result = await limiter.consume("client-a", 5);
```

Windows start at `floor(now / windowMs) * windowMs`. The estimate is `previous * (windowMs - elapsed) / windowMs + current`, as described in Cloudflare's 2017 post on sliding window counters. A request is allowed when `estimate + cost <= limit`; rejected requests are never counted. `resetMs` is the time until the counted usage has fully decayed (end of the next window when the current window has hits, end of the current window when only the previous one has).

A 100-hit burst at the end of a window cannot be repeated right after the edge: at the next window start the estimate is still 100.

## Headers

`headers(result)` returns `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (integer seconds, rounded up) following draft-ietf-httpapi-ratelimit-headers-06, plus `Retry-After` in delay-seconds (RFC 9110 section 10.2.3) for rejected results. Later structured-field drafts are out of scope.

## Middleware

```ts
import { createServer } from "node:http";
import { TokenBucket, createRateLimitMiddleware } from "@trysac/rate-limiter";

const limit = createRateLimitMiddleware(
  new TokenBucket({ capacity: 10, refillPerSecond: 1 }),
  { keyOf: (req) => req.socket.remoteAddress ?? "unknown" },
);

createServer((req, res) => {
  void limit(req, res, () => res.end("ok"));
});
```

Limited requests receive `429` with `Content-Type: application/problem+json`, the body `{"type":"about:blank","title":"Too Many Requests","status":429}` and the rate limit headers; `next` is not called. Options: `failOpen` (default false) and `onEvent` for `{ type: 'limited' }` and `{ type: 'store_error' }`.

## Stores

A `RateLimitStore` has `get`, `set` and an optional atomic `update`. Keys are `prefix + ':' + key`; state is compact JSON. `MemoryStore` is bounded (`maxKeys`, default 10 000). Without `update()` a limiter does get then set, which is not atomic across processes.

### Redis update sketch

This is an untested sketch, not shipped code. It implements `update()` as a compare-and-set loop; `fn` is pure, so retrying it is safe.

```ts
import type { RateLimitStore } from "@trysac/rate-limiter";

interface RedisLike {
  get(key: string): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const SET = "redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1";

const CAS = `
local cur = redis.call('GET', KEYS[1])
if (cur == false and ARGV[1] == '') or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;

export function redisStore(redis: RedisLike): RateLimitStore {
  return {
    async get(key) {
      return (await redis.get(key)) ?? undefined;
    },
    async set(key, value, ttlMs) {
      await redis.eval(SET, [key], [value, String(ttlMs)]);
    },
    async update(key, fn, ttlMs) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = (await redis.get(key)) ?? undefined;
        const next = fn(current);
        const args = [current ?? "", next, String(ttlMs)];
        if ((await redis.eval(CAS, [key], args)) === 1) {
          return next;
        }
      }
      throw new Error("update contention");
    },
  };
}
```

## Errors

Every failure is a `RateLimitError` with `code` `INVALID_CONFIG`, `INVALID_COST` or `KEY_INVALID`. Keys are 1 to 512 characters; costs are integers from 1 to capacity (or limit).
