# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Test files

- `test/token-bucket.test.ts`: 10 immediate calls then rejection with `retryAfterMs` 1000; refill rate 0.5 gives 2000; fractional refill at rate 3; caps after a long idle gap; costs without consumption on rejection; key validation and `INVALID_COST`; key isolation; a clock moving backwards counts as zero elapsed time; non-finite clock rejected; `Date.now` default; compact state under `prefix:key` with expiry; prefix isolation on a shared store; corrupt or oversized state treated as absent; negative stored tokens clamped; a store without `update()`; store failures propagated.
- `test/sliding-window.test.ts`: the 80/20 estimate (cost 20 allowed, cost 21 rejected with `retryAfterMs` 750 and not counted); the retry hint becoming valid; no double burst at a window edge; single cost 100 hit at the edge; waiting for the next window; ignoring windows older than one window; floored `remaining`; backwards clock grants no quota; cost and key validation; key isolation; `Date.now` default; non-finite clock; compact state expiring after two windows; prefix isolation; corrupt state; a store without `update()`; lazy update failure.
- `test/store.test.ts`: set, get and expiry; eviction of the least recently updated key at `maxKeys`; expired keys dropped before live ones; overwrite does not evict; default bound of 10 000 keys; `update` passing and returning values; concurrent updates not losing increments; value unchanged when the update function throws; write validation (key, value and TTL limits); option validation; non-finite clock.
- `test/http.test.ts`: `headers()` output, `Retry-After` omitted when allowed, rounding up and sanitizing non-finite values; middleware 429 response with problem+json body and headers, and `next` calls; works with `SlidingWindow`; `keyOf` receives the request; store errors rethrown by default; `failOpen` with `store_error` event; the middleware still fails open when the event callback throws; invalid keys never fail open; `keyOf` failures propagate; operation without `onEvent`; argument validation.
- `test/index.test.ts`: the exported surface; `RateLimitError` shape; invalid configuration codes for both limiters; the acceptance cases for key length, capacity 0 and header omission; maximal prefix accepted.

## Rules

- Coverage must stay at or above 80 % for lines, branches, functions and statements (`vitest.config.ts`). Lowering the thresholds is not allowed.
- Tests run through the public entry point (`src/index.ts`) and assert observable behavior: return values, thrown errors and their codes.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: they inject a fake clock and use in-memory stores; no network and no shared state between tests.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
