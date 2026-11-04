# Web release verification — 2026-10-29

> Later same-day update: movie synchronization is now live in frontend `6ae2d7a7e9bf5175426b631b`. Movies and TV episode selections offer Watch together. The sections below preserve the earlier release snapshot; their movie-sync deferral is historical. Current verification: 581 unit/integration tests, 38 rules tests, seven multi-client journeys, 232 browser passes with four existing codec skips, and nine actual production playback checks. Detailed current receipts are in `%USERPROFILE%\.codex\tmp\watch-party-movie-sync-20261029`.

## Published versions

- Site: https://partyapp-fun.netlify.app
- Current playback frontend: `6ae24f8206eed6e28f715ef3`.
- Previous uploads/moderation frontend: `6ae23f785fe891efc5a97528`.
- Backend unchanged by the playback release: `party-media-proxy-uploads20261028b`, 100% traffic.
- Safe disabled-upload backend rollback: `party-media-proxy-uploads20261028a`. Both revisions retain private-upload authorization; do not use an earlier backend rollback that omits it.
- Firebase rules unchanged by the playback release. Live hash: `1018981a8be1a37dd23ae064cb32be631cbbbd8cf95c16ea2a4c3ce5c1276373`.

## Playback changes and diagnosis

- Native anime HLS decode/unsupported-source errors try the existing JavaScript HLS engine once. Module startup has a 15-second deadline; cancelled or retired players cannot attach late engines. Existing buffer limits remain.
- The shared HLS owner handles recovery and terminal errors. Room/solo players no longer prematurely replace a recoverable native error with a fatal message. Engine resets do not publish host pause commands.
- ManagedMediaSource compatibility disables remote playback while that engine is active and restores the previous setting on release. AirPlay is unavailable during this compatibility mode.
- YouTube's supported autoplay-blocked event displays a tap-inside-the-player instruction. It clears when playback starts, including during initialization. No overlay blocks the YouTube player.
- Movie/TV details explicitly say: “Solo playback. Movie and TV rooms are not available yet.” No synchronized movie player has been implemented.
- The reported YouTube video `468wQZH-KTo` and Tokyo Ghoul:re episode 1 both played in fresh production test rooms during diagnosis. The original iPhone failure has not been reproduced on physical iOS hardware.
- The episode's first segment was valid H.264/AAC transport-stream data served with an image MIME type. This is a compatibility concern, not a proven cause of the reported iPhone failure. No provider security controls were bypassed.

## Automated verification

Run from `Party_app`, unless stated otherwise:

| Command / check | Result | Evidence limit |
| --- | --- | --- |
| `npm test` | 564 passed, 82 files | Unit and integration tests; includes expected failures observed before fixes |
| `npm run test:e2e` | 228 passed, 4 skipped | Desktop/mobile Chromium and Windows WebKit; before the additional autoplay browser case |
| `npx playwright test tests/e2e/drive-retry.spec.js tests/e2e/anime-room.spec.js` | 42 passed, 2 skipped | Final changed playback paths; includes four-project autoplay feedback coverage |
| `npm run test:rtc` | 6 passed | Real local Auth/RTDB emulators and native peers, not physical-device quality |
| Scoped ESLint on changed playback components, adapters and tests | Passed | Existing `App.jsx` baseline lint debt remains: 21 errors and 4 warnings |
| `git diff --check` in both repositories | Passed | Existing unrelated changes preserved |
| Candidate browser/provider verification | 6 check groups passed; owned room/grants/user cleaned | Preview API responses forwarded with the canonical CORS origin; not iPhone proof |
| Canonical production browser/provider verification | 6 check groups passed; owned room/grants/user cleaned | No API interception; desktop Chromium, not physical iOS |

The four full-suite skips are existing Windows WebKit H.264 decoding limitations. No dependency was added. Git indexes and all three existing `.env` files match the captured baseline; nothing was staged or committed.

Post-deployment verification matched all 23 published asset files to the tested artifact. Desktop/mobile movie details displayed the solo-playback explanation without horizontal overflow. The reported anime episode decoded and played, a controlled native decoder failure recovered through the real JavaScript HLS engine while the shared room remained PLAYING, and the reported YouTube video played before and after switching to a reference video. No application JavaScript errors were captured. This controlled recovery demonstrates the fallback behavior; it does not establish the root cause of the friend's original iPhone failure.

## Earlier uploads/moderation release coverage

- Backend: 156 unit + 38 Node integration + 38 byte-range checks passed, locally and in the Linux image.
- Firebase rules emulator: 36 passed. Live owner/privacy rejection checks and production moderation checks passed with owned data cleanup.
- Actual supplied short and long Drive files returned authorized tickets and exact 2,048-byte ranges. This does not prove continuous two-hour playback.
- Production moderation closed established peers and captured tracks, rejected a banned identity, restored access after unban, and allowed deliberate rejoin after Remove.
- Private upload authorization persists when upload availability is disabled. The previously reported bypass was fixed with explicit user approval and regression coverage.
- Production asset identity, cache headers, malformed-request rejection, upload config origin handling and blocked-CDN navigation checks passed.
- Monitoring checks for frontend/backend are configured for `iamcute936968@gmail.com`. Healthy regional checks were observed; actual alert-email delivery remains unverified.
- Metered reported 500 MB remaining and no overage at the last check. Usage reporting can lag or round; a short TLS relay test transferred approximately 235,560 bytes, so this is not a claim of zero relay use.

## Security review and limits

- No new confirmed vulnerability was identified in the changed playback paths. Checks covered aborted/late imports, duplicate recovery, bounded initialization, retired callbacks, engine cleanup, restoration of remote-playback settings and error-message sanitization. Source resolution and authorization boundaries were not expanded.
- Candidate checks used owned test rooms and fresh anonymous identities; room, access and ban records were removed and test users deleted. Real user rooms were not modified.
- This was a targeted non-destructive review, not a claim that the application or third-party players are completely secure. Physical iOS, hostile network behavior and third-party iframe internals remain outside this verification.

## Still pending

- Retry the reported room playback on the friend's actual iPhone. Windows WebKit cannot establish an iOS media pass.
- Movie/TV synchronized playback requires a verified controllable provider. The current external player has no supported room command interface. A separate production movie playback attempt was blocked by a provider advertising overlay; catalogue/wishlist checks passed, but that attempt is not counted as a movie playback pass.
- Google Drive upload consent is blocked by OAuth `origin_mismatch`. Add `https://partyapp-fun.netlify.app` to Authorized JavaScript origins of the separate Drive OAuth web client in Google Cloud project `project-51f4f70a-e8c6-4bcd-a19`, keeping existing entries. Actual consent/upload must then be retried by the account owner.
- Physical Android two-hour endurance remains incomplete. An earlier run returned to the room-entry page after roughly 17 minutes; its cause is unproven. No current two-hour pass is claimed.
- Actual Iran/VPN connectivity, physical iPhone playback, subjective microphone quality, real alert delivery and a full-length movie session remain unverified. Native Android companion work remains on hold.

Detailed receipts are under `%USERPROFILE%\.codex\tmp\watch-party-playback-release-20261029` and `watch-party-playback-ios-20261029`; earlier release receipts are under `watch-party-uploads-moderation-release-20261028`. Credentials are not included in this report.
