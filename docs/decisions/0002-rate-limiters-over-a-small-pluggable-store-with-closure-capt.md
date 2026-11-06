# Rate limiters over a small pluggable store with closure-captured results

Status: accepted (generated, pending human review)

## Context

APIs need per-client limits, and fixed-window counters allow double bursts at window edges. The same arithmetic, retry hints and response headers are re-implemented in every project. The limiters must work in memory or on a shared backend, be deterministic under test and never grow without bound.

## Decision

Implement a token bucket (continuous refill) and a sliding window counter (previous * remaining fraction + current) over a three-method RateLimitStore (get, set, optional atomic update). State is compact JSON under prefix:key with a bounded size. Each consume call passes a pure transition function to the store and captures the result in a closure, so a store may retry it and the last invocation wins. MemoryStore is a Map with synchronous (atomic) update, a maxKeys bound, expired-first then least-recently-updated eviction. All time comes from an injected clock, and a backwards clock counts as zero elapsed time. The middleware fails closed by default, and never fails open on RateLimitError.

## Consequences

Limits are exact and testable with a fake clock, and a Redis or SQL store only needs get/set (and ideally a compare-and-set update). Without update() the limiter is not atomic across processes. Evicting a key resets its limit, and each MemoryStore insert at capacity costs a sweep of up to maxKeys entries. Corrupt stored state resets the key's quota instead of failing requests. GCRA and IP extraction are intentionally left out.
