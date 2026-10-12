# Phase 0 feasibility report

**Date:** 2026-10-11  
**Scope:** platform scaffold and minimal local/editor proofs only. Verification below was rerun against the final Phase 0 implementation on 2026-10-11.

## Foundation

- Next.js App Router / React / strict TypeScript client, ASP.NET Core 10 API, EF Core 10 with Npgsql, PostgreSQL 17.6, Docker Compose, xUnit, and Playwright scaffold.
- Local draft proof uses Dexie/IndexedDB. The status changes to “Saved on this device” only after the IndexedDB write resolves.
- Service worker uses a cached root navigation fallback and same-origin runtime asset caching; API requests are excluded.
- The API has liveness and database readiness endpoints. Compose keeps PostgreSQL unexposed and uses a named data volume.

## Typst candidate

`typst-wasm` 1.0.0 documents a browser Web Worker and caller-provided WASM modules; `@typst-wasm/fonts` 1.0.0 supplies font binaries. Papyr packages those assets under the web origin and compiles to PDF without a remote compiler. The initial sample includes Czech text and a math expression. Compile a first time online, then compile again offline to test the cached worker, engine and fonts.

This is a third-party wrapper around the Typst compiler, not a Typst-maintained browser API. The pinned 1.0.0 browser build passed Chromium PDF compilation with math and Czech text, then a second compile after the browser context went offline. Cross-origin isolation headers are enabled, and Typst network resource fetches are explicitly disabled. This proves the bundled sample path, not arbitrary imports/packages or a full browser compatibility matrix. The fonts package needs a separate redistribution-license audit before release.

## tldraw candidate and license

The Chromium proof creates a pen stroke and image, saves the document snapshot into IndexedDB, reloads it, and verifies both records and image rendering. It uses tldraw local persistence for image asset loading alongside the snapshot table. This is intentionally two stores and is **not** the production Papyr persistence design. The official docs distinguish document data from device session state and show snapshots for custom persistence.

Official tldraw terms state that the SDK only permits development by default. Production requires an active trial, hobby, or commercial license key, with use constraints; hobby/trial keys also send license/SDK/URL analytics. The production build disables the proof route when no key is configured. No key was requested, obtained, or committed. Confirm the applicable license and data collection terms before any production deployment.

## Phase 0 exit checklist

- [x] `docker compose -f infra/compose.yaml up -d --build` reports healthy web/API/PostgreSQL; `/health/live` and `/health/ready` return healthy/ready.
- [x] Playwright verifies IndexedDB draft survives reload and shell navigation fallback works offline.
- [x] Playwright verifies Typst PDF compilation with math and Czech text, then compiles again offline after warming local assets.
- [x] Browser check verifies pen input, JSON snapshot round-trip across reload, and image asset reopening.
- [x] `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `dotnet test` (Docker SDK 10.0 image), and Playwright pass. Playwright: 4 production + 1 development scenarios; xUnit: 1 passed.

**Phase 0 exit evidence is complete. Phase 1 remains untouched.**

## Remaining limits

- Native OS install/launch was not separately exercised; Chromium verified the install manifest, icons, service-worker shell and offline hard reload.
- Typst font redistribution terms and a broader browser/device matrix remain unchecked.
- tldraw production use remains blocked pending confirmation and configuration of an applicable license key.
- The API readiness check works against PostgreSQL, but schema migrations, authenticated data operations and sync are out of scope.
