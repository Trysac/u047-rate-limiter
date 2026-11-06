# rate-limiter

[![npm version](https://img.shields.io/npm/v/@trysac/rate-limiter.svg)](https://www.npmjs.com/package/@trysac/rate-limiter)
[![license: MIT](https://img.shields.io/npm/l/@trysac/rate-limiter.svg)](LICENSE)
[![CI](https://github.com/Trysac/u047-rate-limiter/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u047-rate-limiter/actions/workflows/ci.yml)

Token bucket and sliding window counter rate limiters with an injectable clock, a pluggable store, a bounded in-memory store and standard 429 headers.

## Problem

APIs need per-client limits to protect themselves, and naive fixed-window counters allow double bursts at window edges. This library implements token bucket and sliding window counter arithmetic, exact retry hints (`retryAfterMs`) and standard `RateLimit-*` and `Retry-After` response headers. It works in memory through the bundled `MemoryStore` or on a shared backend through a small `RateLimitStore` interface.

## Install

```sh
npm install @trysac/rate-limiter
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies.

## Usage

```ts
import { TokenBucket, headers } from "@trysac/rate-limiter";

const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 });
const result = await bucket.consume("client-a");
console.log(result.allowed, result.remaining, result.retryAfterMs);
console.log(headers(result));
```

Keys are 1 to 512 characters. Costs are integers from 1 to the capacity (or limit). Invalid input throws `RateLimitError`. Both limiters accept an injectable `clock` returning milliseconds; a clock that moves backwards counts as zero elapsed time.

## API

| Export | Signature | Description |
|---|---|---|
| `TokenBucket` | `new TokenBucket({ capacity, refillPerSecond, store?, clock?, prefix? })` | Token bucket with continuous refill. `consume(key, cost?)` resolves to a `RateLimitResult`. Default prefix `tb`. |
| `SlidingWindow` | `new SlidingWindow({ limit, windowMs, store?, clock?, prefix? })` | Sliding window counter: `previous * (windowMs - elapsed) / windowMs + current`. `consume(key, cost?)`. Rejected requests are never counted. Default prefix `sw`. |
| `MemoryStore` | `new MemoryStore({ clock?, maxKeys? })` | Bounded in-memory `RateLimitStore` with a synchronous, atomic `update`. Default `maxKeys` 10 000. At the limit it drops expired keys first, then the least recently updated key. `size` getter. |
| `RateLimitStore` | `interface { get; set; update? }` | Pluggable storage. Without `update` the limiters perform get then set, which is not atomic across processes. |
| `RateLimitResult` | `{ allowed, limit, remaining, resetMs, retryAfterMs }` | Result of `consume`. `retryAfterMs` is 0 when allowed. |
| `headers` | `(result: RateLimitResult) => Record<string, string>` | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds), plus `Retry-After` (seconds) when rejected. |
| `createRateLimitMiddleware` | `(limiter, { keyOf, failOpen?, onEvent? }) => (req, res, next) => Promise<void>` | Node `http` middleware. When limited it responds 429 with `application/problem+json` and the headers, without calling `next`. Otherwise it calls `next` once. Store errors are rethrown unless `failOpen` is true. |
| `RateLimitError` | `class extends Error { code }` | `code` is `'INVALID_CONFIG'`, `'INVALID_COST'` or `'KEY_INVALID'`. Messages never contain caller input. |

Options and errors:

- `INVALID_CONFIG`: non-integer or out-of-range capacity, limit, windowMs, maxKeys or prefix; refill rate not in (0, 1e9]; a clock that is not a function or returns a non-finite value.
- `INVALID_COST`: cost not an integer from 1 to capacity (or limit).
- `KEY_INVALID`: key not a string of 1 to 512 characters.
- Limits: integer configuration values are at most 2 147 483 647; prefixes are 1 to 64 characters.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model, limits and out-of-scope items. In short: `keyOf` must not trust `X-Forwarded-For` blindly; eviction resets a key's limit; events never include keys; the library never logs; implement `update` on shared stores to get atomic counting across processes.

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
