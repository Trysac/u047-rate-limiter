# Project record: rate-limiter

## Objective

Provide a dependency-free TypeScript library for per-key rate limiting in Node.js services. It implements a token bucket and a sliding window counter over a pluggable store, exact retry hints, standard `RateLimit-*` and `Retry-After` headers, and a Node `http` middleware that answers 429 with `application/problem+json`. It is aimed at backend developers who would otherwise re-implement this arithmetic in each project.

## Scope

In scope:

- The public API documented in the README: `TokenBucket`, `SlidingWindow`, `MemoryStore`, the `RateLimitStore` interface, `headers()`, `createRateLimitMiddleware()` and `RateLimitError`.
- Injectable clock, key prefixes, costs and validation with stable error codes.

Out of scope:

- GCRA (generic cell rate algorithm).
- Client IP extraction and authentication; `keyOf` is supplied by the application.
- Distributed consensus. Cross-process atomicity depends on the store's `update` implementation.
- The structured-field form of the rate limit headers (only the draft-ietf-httpapi-ratelimit-headers-06 names are produced).
- Logging and metrics collection.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Recorded values only. Figures come from the factory ledger and the time log.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 210564 / 110016 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.6888 | factory ledger |

## Factory run u047 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2576 | 93997 | 0 | 4473 | 0.4730 |
| fix-1 | claude-sonnet-5-5 | no | 8 | 1714 | 8522 | 56644 | 0.0441 |
| audit | claude-sonnet-5-5 | no | 8 | 3062 | 27569 | 67112 | 0.1063 |
| fix-2 | claude-sonnet-5-5 | no | 6 | 3018 | 9232 | 40774 | 0.0573 |
| docs | claude-haiku-5-5 | no | 38963 | 8225 | 0 | 0 | 0.0080 |

Total: $0.6888. Prices: Anthropic list prices.
