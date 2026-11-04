# Movies and TV release verification - 28 October 2026

Live at https://partyapp-fun.netlify.app. Open Discover, then Movies & TV.

## Released behavior

- TMDB movie and TV browsing, search, posters and details.
- Actual TV season and episode metadata, including specials when listed.
- VidSrc solo playback with title-bound progress events and saved-position resume.
- Guest wishlist/history and private account movie libraries with explicit guest import.
- Wishlist and resume links in Library; existing five-destination navigation retained.
- The rollout also includes the previously completed and tested anime-sync and manga changes in this checkout. Native Android work remains on hold. Movie room synchronization remains deferred.

## Release identifiers

- Netlify production deploy: `6ae1a7e19deee647a3bafe7f`.
- Previous Netlify production deploy: `6adfb2d187482699468c2d74`.
- Cloud Run revision: `party-media-proxy-movies20261028`, serving 100% of production traffic.
- Previous Cloud Run revision: `party-media-proxy-anime20261027`.
- Backend image digest: `sha256:18d7e9a5552fef9a249d84ee08d4d3ccd2102277fb0638639606c92203a07d01`.
- Firebase database deployment job: `1793173278204`, successful; downloaded deployed rules matched the tested source exactly.
- All 21 public frontend assets matched the tested artifact bytes, allowing only Netlify's hosting comment in HTML.

Existing backend environment entries, secret references and resource limits were preserved. The TMDB credential was added only to the backend; it was absent from the frontend artifact. Existing hosting resources were used without a paid-plan upgrade. No Git staging, commit or push was performed.

## Automated checks

Commands below run from Party_app unless stated otherwise. Feature changes and both fixes followed failing-test-first development.

| Command/check | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/unit tests/integration --maxWorkers=3` | 442 passed, 76 files |
| `npm test` from media-proxy | 156 passed: 96 unit, 22 integration and 38 HTTP checks |
| Same backend suite inside the built Node 24 Linux image, with `NODE_ENV=test` and no external network | 156 passed |
| Firebase `emulators:exec --only database,auth --project demo-watch-party --config firebase.emulators.json "node --test --test-force-exit tests/rules/database.test.mjs"` | 29 passed |
| `node node_modules/@playwright/test/cli.js test --workers=3` | 212 passed; four existing Windows WebKit H.264 skips |
| `node node_modules/@playwright/test/cli.js test tests/e2e/movies.spec.js --workers=3` after the player-setting correction | 12 passed |
| Auth/RTDB emulator account browser journeys | Three passed; the movie account journey also passed again after the rules fix |
| Scoped ESLint for new/changed feature modules and `node node_modules/vite/bin/vite.js build` | Passed |

Existing App.jsx lint debt (21 errors and four warnings) was unchanged. The existing large HLS chunk build warning remains. Neither is counted as a clean repository-wide lint result.

## Live production proof

- Thirteen canonical backend checks passed: health, movie browse/search/details, TV season episodes, existing anime/manga catalogue endpoints, invalid input rejection and CORS restrictions.
- Six browser verification groups passed on the canonical production URL without request interception: asset identity; desktop and mobile search/poster/wishlist/Library/detail reload; desktop and mobile TV episode selection; actual sample playback and resume.
- The rights-checked Big Buck Bunny sample decoded inside the deployed app. Provider-confirmed progress saved at 10.2 seconds; reopening actually played from 12.62 seconds. Leaving the Watch page removed its iframe.
- Both viewport sizes contained their content without horizontal overflow. TV season 2 listed ten actual episodes. No TV stream was played during these checks.
- Eleven live Firebase checks passed: exact deployed rules, owner read/write, cross-account read/write denial, unauthenticated read denial, scalar rejection, record bounds, valid sparse records and deletion. Both temporary QA identities and their data were deleted, with cleanup verified.

## Fixes and security review

- **Playback correctness:** the provider stalled with `autoplay=0`; the same sample played with its default setting. The embed URL now retains that default on the Watch page and preserves the resume parameter. Unit, component, browser and actual deployed playback checks passed.
- **Low severity, approved and fixed:** `accounts/<uid>/movieLibrary` previously accepted scalar containers, bypassing its per-record bounds. The parent container now requires children. Regression checks reject direct scalar writes, parent updates, scalar transactions and scalar records, while preserving valid transactions, final-item deletion and repair of old malformed data. The original 64 KiB scalar write was rejected by the deployed rules.
- No additional confirmed finding was identified in the reviewed interfaces. Checks covered fixed metadata destinations, bounded requests, account isolation, exact player origin/window/title/episode binding, credential exclusion and resource-limit preservation.

## Limits

This is a short functional check, not proof that every film, TV episode, region or device works. The provider emitted six cross-origin script errors during playback; the application emitted none. Its advertising and availability remain external dependencies.

Google sign-in was previously confirmed by the user and was not repeated with their account during this release. Account synchronization checks used actual local Auth/RTDB emulators; live Firebase checks used temporary anonymous QA identities. Mobile checks used browser viewports, not physical Android or iPhone hardware. Long sessions, movie room synchronization, a complete third-party-player security audit and stress testing of production were not performed.

Release receipts, test output and screenshots are retained locally under `%USERPROFILE%/.codex/tmp/watch-party-movies-release-20261028/`. Credentials and private provider snapshots are excluded from this report and public artifacts.
