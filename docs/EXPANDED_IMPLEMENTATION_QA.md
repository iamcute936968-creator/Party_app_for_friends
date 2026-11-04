# Expanded implementation checkpoint — 26 October 2026

The web/backend changes below were released on 26 October 2026 as Netlify deploy
`6adf81462e13258dc7d5eb2a`, Cloud Run revision
`party-media-proxy-expanded20261026`, and Firebase database job `1793032257230`.
Production is https://partyapp-fun.netlify.app. The Android companion remains on
hold. A real user Google login and physical-device tests remain unverified.

## Implemented and released

- Google account linking preserves a guest UID. Existing-account collisions need
  an explicit account switch outside a room. Account transitions and room entry
  have synchronous mutual exclusion, including two actions in one event.
- Account-private viewing history, wishlist and resume use Firebase transactions.
  Guest imports are explicit. Account changes suppress stale snapshots and never
  automatically upload another account's cache. Rules bound storage to 50 numeric
  slots and validate every entry; invitations and tokens are excluded.
- Private display names and Google photos persist in account profiles. Publishing
  a photo to a room requires explicit consent. Images use a narrow Google host
  allowlist with initials as fallback. Room names/identity ownership remain stable.
- Movie/anime discovery uses fixed Wikipedia search/details endpoints, safe
  metadata and image/source URLs, attribution, cancellation, bounded results and
  caching. It supplies metadata, not playback rights or movie streams.
- The authenticated `/api/rtc/ice` route and shared browser ICE supplier are
  implemented. Permanent provider secrets stay server-side. Credentials are
  scoped/cached in memory, periodically refreshed on existing peers, and stale
  requests cannot create peers after leaving. A Metered adapter now supports
  expiring credentials, propagation warmup and rotation. Live provider relay
  checks passed. The deployed authenticated broker also supplied credentials
  that delivered a native forced-relay data message. Production voice/video
  regression journeys passed, without forcing their selected route to relay.
- Screen-sharing revocation was reported and explicitly approved. Broadcasters
  now independently watch viewer grants; revoked peers close even when the viewer
  ignores Firebase callbacks. Own revocation ends capture. Grant rejoin, stale
  negotiation failures and unchanged-admission replay have regression coverage.
- A Drive file with no decodable video track now produces actionable H.264
  guidance instead of appearing ready while playing audio alone.

## Verification evidence

- `npm run test:unit`: 239 passed (rerun after Metered ICE support).
- `npm run test:integration`: 100 passed.
- `npm run test:rules`: 22 passed against local Auth/Database emulators.
- `npm run test:rtc`: two browser/emulator scenarios passed, using actual Firebase
  SDKs/rules and native RTC. OAuth is substituted only in the account scenario;
  this is not live Google sign-in proof. The voice/screen scenario uses synthetic
  microphones and canvas video, not an acoustic microphone-quality measurement.
- `node node_modules/@playwright/test/cli.js test`: 146 passed, two existing
  Windows WebKit/H.264 skips. Desktop/mobile Chromium and WebKit UI are covered.
- `npm run build`: passed.
- Account browser regression: 12 passed across desktop/mobile Chromium and
  WebKit. Google OAuth is substituted in these local UI tests.
- Candidate and production each passed 13 live browser journeys: artifact
  integrity, guest library, room entry, avatars, typing, fullscreen conversation,
  access rejection, real YouTube progress/seek/resume, native voice recovery and
  native screen video. Audio and display capture use synthetic fixtures.
- Three additional production checks passed: owner account profile/library
  writes and reads, denial of cross-identity access, and real discovery search
  and details. Account rule probes used fresh anonymous Firebase identities;
  they are not proof of Google authentication or Google cross-device sync.
- Full ESLint: existing backlog remains 22 errors and five warnings. New standalone
  modules and their focused tests passed scoped lint.
- Media proxy `npm test`: 40 unit tests, 10 integration tests and 38 HTTP
  assertions passed after Metered and Drive-ticket revocation changes.
  Live Wikipedia search/details also succeeded.
- A bounded live Metered probe created a temporary credential and delivered a
  small data-channel message between native Chromium peers forced to relay.
  Both normal and TLS-only endpoint configurations passed. This proves provider
  connectivity, not the deployed app broker, physical audio or long sessions.

The first full browser run exposed a WebKit repeated-admission callback loop;
a failing unit regression was added, the callback was made idempotent, and the
full final matrix above passed. The native revocation/rejoin cases explicitly
clean their own local hostile-client fixture between independent scenarios while
abrupt socket-disconnect cleanup is settling.

## Supplied Drive files — production baseline only

- Small: `1u3qPiugUl6mcnYIaT7WJ8jDca5BRqzM5`. FFmpeg inspection reports HEVC,
  1080×1920 video with AAC audio, duration 65.80 seconds. Production Chromium
  reports 0×0 video despite audio/time advancing. This browser cannot decode that
  video track. The file was not changed or transcoded.
- Large: `1TmsiRqfcQGtIcFlJ1Xod8-HEemEeN6RQ`. Real production browser playback
  decoded 1280×720 frames and seeking passed. Reported duration is 4290.675 seconds
  (about 71.5 minutes), not two hours. A full-duration soak has not been completed.
- An initial probe wrongly treated metadata/audio progress as video success.
  Corrected checks bind the exact file URL and require nonzero decoded video
  dimensions/frames. Only corrected evidence is used here.
- Four owned QA rooms and five fresh QA authentication users were removed after
  these probes. No unrelated production rooms/accounts were touched.

## Provider setup and unresolved security work

- Cloudflare signup reached a card requirement and the user's card was declined.
  Cloudflare setup was stopped; no paid resource is authorized.
- User created Metered app `watch-party-ayush` and selected its $0 500 MB/month
  TURN plan. Screenshot confirms no overages. Credentials are saved locally with
  Windows encryption and were verified without exposing secrets. The provider
  adapter and browser endpoint allowlist are released; server-only
  production configuration is now installed. The provider Master Secret stays
  server-side; no credential file was included in either uploaded artifact.
  Existing environment entries and secret references were preserved.
- After the user enabled Google, live Firebase inspection returned
  `google.com` with `enabled: true`. Added only `partyapp-fun.netlify.app` to the
  OAuth authorized domains and read back the configuration to confirm that all
  existing domains were preserved. Localhost was not added. A real user Google
  sign-in through the new application UI remains unverified.
- A confirmed Drive-ticket issue was reported and the user approved remediation:
  deleting a viewer's room grant made Firebase reads return 401, but the viewer's
  existing media ticket still returned 206/1024 bytes. `GET /media/:fileId` checks
  signature/expiry without current membership in the preceding production release.
  The approved local fix encrypts caller authorization in opaque tickets,
  rechecks access before each media request, and polls authorization during active
  transfers. Local tampering, expiry, grant revocation and active-stream tests
  pass; independent review identified no concrete surviving bypass. The fix is
  now deployed. Both candidate and canonical production probes returned 206 for
  authorized 1024-byte start/seek ranges, then 403 for the same media ticket after
  its viewer grant was deleted. The relay broker returned 200 before and 403
  after revocation. Streaming responses were private and uncacheable. Managed
  Codex Security evidence is retained separately without credentials or URLs.
- Retired backend aliases `security20261025` and `qa20261025` were removed and
  verified to return 404, preventing access to the prior vulnerable revision.
  The current revision serves 100% of production traffic.

## Release verification and security limits

- Firebase rules readback exactly matches the tested source. Preflight changes
  were limited to the additive `accounts` branch and optional room profile photo.
  Google provider is enabled; the production OAuth domain was added while
  preserving existing authorized domains. Localhost was not added.
- Netlify's published-deploy pointer matches `6adf81462e13258dc7d5eb2a`. All
  13 static artifact files match production; only the previously documented,
  non-executable Netlify hosting comment is normalized in the HTML hash check.
- The actual Linux image passed 40 unit, 10 integration and 38 HTTP checks.
  An initial container test invocation used the production environment without
  its required secret and failed fixture setup. The corrected test-environment
  invocation passed; production fail-closed behavior remains separately tested.
- A new live-account probe initially assumed anonymous sign-in occurred on Home.
  It was corrected to explicitly create its own QA identities; this was a test
  setup correction and did not change product authentication.
- No new finding was identified in bounded cross-identity, revoked-ticket,
  revoked-broker, tampering, expiry, endpoint allowlist and secret-error checks.
  Previously approved Drive and screen-share fixes are deployed. Active-stream
  revocation polling and hostile screen-viewer tests passed locally; a real
  production active-transfer/hostile-video revocation test remains unverified.
  Previously delivered or buffered bytes cannot be recalled.
- All live QA rooms and their grants, plus temporary account profile/library
  records, were removed using explicit ownership checks. Authentication cleanup
  passed for the candidate, frontend production and account probes. A network
  interruption during the final backend production cleanup occurred after room
  removal. Its known host identity was subsequently removed; deletion of its
  anonymous guest identity remains unverified because the guest UID was not
  retained before deletion. No unrelated identity was selected for cleanup.
  No Git staging, commit or push occurred.

## Remaining requested work

1. Complete a real user Google login and verify cross-device cloud library/profile
   sync. Provider configuration and isolated local sync tests already pass.
2. Measure actual TURN usage and long-session credential renewal. The $0 500 MB
   allowance is for evaluation; it does not guarantee movie-length relayed
   screen sharing. No paid upgrade or new paid service was activated.
3. Physical Windows/USB Android microphone quality, background/network recovery,
   and long-session checks. ADB currently detects no phone. No real iOS proof.
4. Rights-cleared private uploads/shared media, production monitoring/alerts and
   recovery, and host moderation/durable bans are not implemented yet.
5. Continue bounded security review and deployment gates for the remaining
   features. Do not label local/emulated results as production proof.

For free-only uploads, research confirmed that Google Drive `drive.file` supports
resumable creation, quota inspection and private reader permissions. Reusing a
user's own Drive could avoid a new paid storage service; that path has not been
implemented or tested live. No new bucket, R2 subscription, database provider,
paid relay or paid alerting resource was created.

All work preserves the existing dirty tree. No Git staging, commit or push.
