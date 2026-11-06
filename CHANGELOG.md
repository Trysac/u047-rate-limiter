# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are derived from Conventional Commits.

## [Unreleased]

### Added

- Added `TokenBucket`, `SlidingWindow`, a bounded `MemoryStore`, `headers()` for `RateLimit-*` and `Retry-After`, `createRateLimitMiddleware` (429 problem+json, `failOpen`, `onEvent`) and `RateLimitError` with stable codes.
- Initial project structure from the factory utility template.
