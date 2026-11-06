# Architecture

## Overview

`@trysac/rate-limiter` is a small, dependency-free TypeScript library published to npm as ES modules with type declarations. It provides a token bucket and a sliding window counter rate limiter, both built on a pluggable key-value store, a bounded in-memory store and helpers for standard 429 responses.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Re-exports everything consumers import. |
| `src/types.ts` | Public types: `RateLimitResult`, `RateLimitStore`, option interfaces, `Limiter`, `Middleware`, events. |
| `src/errors.ts` | `RateLimitError` with the stable `code` values. |
| `src/internal.ts` | Shared validation, clock reading, state parsing and the `mutate` helper. Not re-exported. |
| `src/token-bucket.ts` | `TokenBucket`: continuous refill arithmetic. |
| `src/sliding-window.ts` | `SlidingWindow`: window counter estimate and retry hints. |
| `src/store.ts` | `MemoryStore`: bounded in-memory store with synchronous update. |
| `src/http.ts` | `headers()` and `createRateLimitMiddleware()` for Node `http` objects. |

## Boundaries

- No runtime dependencies. Any addition is justified in [STACK.md](STACK.md).
- The library performs no I/O of its own beyond calls to the injected store. It never logs and never reads the network.
- Invalid input throws `RateLimitError` (with a `code` property), not built-in error types.
- Limiters persist compact JSON state under `prefix:key`.

## Build and distribution

`npm run build` compiles `src/` to `dist/` with `tsconfig.build.json`. Only `dist/` is published (`files` in `package.json`).

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with [0001](decisions/0001-record-architecture-decisions.md).
