# Security

This document is the threat model of `@trysac/rate-limiter`. To report a vulnerability, follow the root `SECURITY.md`.

## Threat model

The library decides, per key, whether a request may proceed. It never logs, never reads the network and never parses request bodies. The attacker is an API client that wants to exceed its quota, exhaust memory, or make the limiter fail.

### Defended

| Threat | Mitigation |
|---|---|
| Key flooding to exhaust memory | Keys are limited to 512 characters and prefixes to 64. `MemoryStore` holds at most `maxKeys` entries (default 10 000), drops expired entries first and then the least recently updated one. |
| Invalid keys becoming a bypass | The middleware rethrows `RateLimitError` (for example `KEY_INVALID`) even with `failOpen: true`, so an empty or oversized key cannot disable limiting. |
| Oversized or tampered stored state | Stored state is parsed only up to 256 characters. Malformed, oversized or non-finite state is treated as absent (a fresh quota for that key). Token counts above capacity are clamped. |
| Clock moving backwards | The token bucket keeps its last timestamp and the sliding window keeps its stored window, so no quota is granted. |
| Information leaks | Events carry only `type` and never include keys. Error messages never contain caller input. The library never logs. |
| Observer failure | An `onEvent` callback that throws does not change how the request is handled. |
| Store outages | By default store errors are rethrown (fail closed). |

### Not defended

| Threat | Limit |
|---|---|
| Spoofed client identity | `keyOf` is supplied by the application. It must not trust `X-Forwarded-For` (or similar headers) blindly; take the address from a trusted proxy hop or use an authenticated identity. The library does not extract IP addresses. |
| Eviction as a bypass | Evicting a key resets its limit. A client that can create many distinct keys can push a victim key out of `MemoryStore`. Size `maxKeys` above the number of live keys expected, or use a shared backend with its own eviction policy. |
| Store outages with fail-open | `failOpen: true` calls `next()` and emits `{ type: 'store_error' }`, so protection is lost during the outage. Choose it only when availability matters more than protection. |
| Racing processes | `MemoryStore.update` is synchronous and atomic within one process. Without `update()` a limiter does get then set, which is not atomic across processes: concurrent requests can both pass. Shared stores must implement `update()` atomically in their own backend. |
| Clock injection errors | The library trusts the injected clock to return finite numbers; a clock that goes backwards is tolerated, but its readings are otherwise not checked for plausibility. |

## Limits

| Limit | Value |
|---|---|
| Limiter key length | 1 to 512 characters |
| Prefix length | 1 to 64 characters |
| Parsed limiter state | at most 256 characters |
| `MemoryStore` key length | 1 to 1024 characters |
| `MemoryStore` value length | at most 4096 characters |
| `MemoryStore` entries | `maxKeys`, default 10 000 |
| Integer configuration values | 1 to 2 147 483 647 |
| Refill rate | greater than 0 and at most 1e9 tokens per second |
| Cost | integer from 1 to capacity (or limit) |

Violations raise `RateLimitError` with the code `KEY_INVALID`, `INVALID_COST` or `INVALID_CONFIG`.

## Out of scope

GCRA, client IP extraction, authentication and distributed consensus.
