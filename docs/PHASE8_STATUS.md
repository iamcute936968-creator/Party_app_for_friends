# Phase 8: room and social experience

## Phase 8.1: live connection feedback

Implemented locally on 2026-10-24. Not deployed.

The room header reports this client's Firebase transport connection: Connecting,
Connected, Reconnecting, or Connection unavailable. After an established
connection is lost, it warns that room updates may be out of date. Recovery
clears the warning automatically. Subscription errors show generic refresh
guidance. Status changes are announced politely without moving keyboard focus.

The observer reads `.info/connected`; it does not write presence, playback, chat,
or host-session state. Connected describes the local Firebase transport, not
another participant's connectivity, room authorization, or media availability.

## Initial inspection

- Root repository: `main`, `c28a2c7`; media proxy is here. Its pre-existing
  modifications have been preserved.
- Nested frontend repository: `fix/foundation-stability`, `e333ebd` before this
  change. Changes for this milestone are confined to the frontend repository.
- Chat already uses push-key messages. Room displays the latest three messages.
- Participants currently use one boolean node per username. Existing host
  sessions separately observe `.info/connected` for playback interruption.
- Participant reconnect and multi-tab presence need their own milestone; the
  new connection indicator does not change their lifecycle.
- `ROADMAP.md` describes an earlier Milestone 4B snapshot. The current source
  already contains the later playback and Drive streaming work.

## Verification

Tests were written and run before the implementation. The existing Room failed
the four new UI cases, and the new hook did not yet exist. Final checks:

- `npm run test:unit`: 11 passed.
- `npm run test:integration`: 8 passed, including the real hook-to-Room path.
- `npm run test:e2e`: 8 passed; host and member across Chromium desktop/mobile
  and WebKit desktop/iPhone 13 profiles. Desktop is 1440x900; Chromium mobile is
  390x844; the WebKit iPhone preset uses a 390x664 viewport and 390x844 screen.
- `npm run build`: passed.
- New hook, status component, tests, and test configuration pass focused ESLint.
- Whole-project ESLint still reports the pre-existing 59 errors and 7 warnings.
- Existing proxy suite: 38 passed during baseline verification; proxy code was
  not changed for this milestone.

Browser tests use the real App and React StrictMode, with intercepted Firebase
SDK responses and blocked unexpected external requests. They verify initial
connection, loss/recovery, draft preservation, chat after reconnect, generic
failure feedback, and absence of browser errors. They do not establish live
Firebase behavior, two-client media synchronization, or physical iPhone support.
Playwright screenshots and run output are stored in the OS temporary directory.

## Running checks

After `npm ci`, run `npx playwright install chromium webkit` once to install the
test browsers. Then run the test scripts and build above. Browser tests start their own
loopback-only Vite server on `127.0.0.1:5175`; that port must be available.
Vitest's Firebase alias is test-only. No fixture API is included in the normal
production build.

On 2026-10-24, the user selected free local WebKit testing for this Windows
machine. WebKit 27.2 (Playwright build 2370) was installed and its four browser
checks passed. The `webkit-desktop` and `webkit-mobile` projects use Playwright's
Desktop Safari and iPhone 13 presets. These are Safari-style engine and device
emulation checks; they do not run Apple's iOS Simulator, actual Safari, or a
physical iPhone. See [Playwright browser support](https://playwright.dev/docs/browsers).

To run only the WebKit checks without relying on npm argument forwarding:

```powershell
node node_modules/@playwright/test/cli.js test --project=webkit-desktop --project=webkit-mobile
```

## Following milestones

1. Participant reconnect and connection-scoped presence are implemented locally
   in 8.2 below. Provider rules and mixed-client rollout still need verification.
2. Chat feedback and bounded UI history are implemented locally in 8.3 below.
   Database ownership/rules and server retention remain separate work.
3. Transient reactions with presentation expiry and no playback writes are
   implemented locally in 8.4 below. Server retention remains separate work.
4. Invite sharing and room-entry error recovery are implemented locally in 8.5
   below. Media submission feedback is implemented locally in 8.6 below;
   Drive preparation retry is implemented locally in 8.7 below. Player error
   feedback, stream renewal and screen-share recovery are implemented locally
   in 8.8-8.10 below. Live-provider and cross-network validation remain separate work.

Security findings are reported to the user before any security fixes. No cloud
configuration, Firebase rules, deployment, or Git publication is part of 8.1.

## Phase 8.2: connection-scoped presence and premium interface

Implemented locally on 2026-10-24; not deployed. Home and Room now use charcoal
surfaces, warm white type, restrained vermilion controls, locally hosted Manrope,
and an original cinematic landscape. Emoji avatar selection and purple UI are
removed. See [design evidence and deviations](PREMIUM_DESIGN_QA.md).

Each browser connection writes a Firebase push-key child at
`rooms/{roomId}/participants/{username}/connections/{connectionId}: true` only
after its server-side disconnect removal is armed. Reconnect creates a fresh
child. Leaving/unmounting removes only owned children. The participant list
counts each username once when any connection is true and also reads legacy
boolean `true` entries. Empty, false and malformed connection values are not
listed. Cleanup guards reject stale callbacks and late writes. An explicit
leave posts a departure message only if the subsequent read finds no active
connection; that read/message pair is advisory, not transactional.

Host-session IDs, reference-clock writes, seek ownership, media adapters, and
WebRTC username addressing retain their existing behavior. Streaming ticket
loading waits until this client's participant write is acknowledged. The
existing proxy still sees a truthy participant object under the same username;
its authorization logic and deployment are unchanged.

### Migration and rollback

This changes the participant value shape. No production data migration ran.
The reader supports legacy booleans, but an old client can still overwrite or
delete a username parent and clobber new connection children. Before rollout,
reload existing clients and validate rules against connection-child writes and
disconnect operations. Do not claim concurrent old/new writers are safe.
Rollback must stop/reload new clients before restoring the previous boolean
writer; do not bulk-delete room or participant data. Host-session data is
separate and must be preserved. Two tabs sharing a username retain distinct
presence only; independent host authority or screen-share identity for identical
usernames is not provided by this milestone.

### Verification for 8.2

TDD evidence: new presence tests first failed because the module did not exist;
the premium interface suite initially failed three Home and Room cases. The
implemented behavior now passes:

- Unit tests: 20 passed (including 9 presence cases).
- Integration tests: 17 passed (including shared-storage two-tab cleanup,
  server disconnect/reconnect, StrictMode/room changes, generic errors, UI and
  peer-content escaping).
- Browser tests: 10 passed, 2 explicitly skipped on this Windows WebKit build.
  Eight host/member UI checks run on all four desktop/mobile profiles. Two
  additional Chromium checks use the real Room, HTML5 adapter, video element
  and timeline with an actual four-second H.264 clip. They check duration,
  play/pause stability, pointer seek, and decoded frame changes.
- Windows WebKit returned media error code 4 (`MEDIA_ERR_SRC_NOT_SUPPORTED`)
  for that clip on both profiles despite advertising H.264 support. Those two
  media checks are skipped only for Windows WebKit, with the reason in the
  test. This does not establish Safari/iPhone playback. Playwright documents
  [platform-dependent media codecs](https://playwright.dev/docs/browsers#webkit).
- Production build and focused ESLint pass. Whole-project lint remains at 59
  pre-existing errors, with warnings reduced from 7 to 6. `git diff --check`
  passes. No dependency upgrades were made for this slice.

The checked-in synthetic clip is generated with FFmpeg `testsrc2` (320x180,
24 fps, 4 seconds, H.264 baseline/yuv420p, no audio). Media harness files are
test-only and are not imported by the production application. Firebase SDK
interception remains test-only. Browser and shared-storage fixtures are local
evidence, not live Firebase, Google Drive, WebRTC, or two-device sync proof.

There is no active gcloud account here and no checked-in Firebase rules file;
deployed database read/write authorization and schema compatibility remain
unverified. Live rules must be inspected and tested before deployment. Security
review results are retained separately; discovered security issues require the
user's approval before fixes.

## Phase 8.3: conversation feedback and recent history

Implemented locally after the user approved dependency remediation and the next
implementation slice. Premium Home/Room styling is retained.

- Sending feedback follows the Firebase write promise; Sent means write
  acknowledgement, not delivery/read confirmation. Duplicate submits are
  guarded synchronously while a write is pending.
- A failed write keeps the draft and focus, shows generic retry guidance and
  permits an explicit retry. Newer typing survives an earlier acknowledgement.
- Room/user changes and unmount invalidate old completion callbacks and reset
  draft ownership; an already-submitted server write cannot be cancelled.
- The conversation displays the latest 50 messages using stable Firebase keys,
  supporting legacy arrays and malformed-record handling. Peer text remains
  JSX text. A scrollable, politely announced log follows new messages while the
  reader is at the bottom and preserves position when reading older messages.

The limit applies to the conversation UI state/display. Firebase still sends
the existing full-room snapshot and may retain/cache all history; network,
database retention and server authorization are not bounded by this feature.
No stored messages were pruned, no schema/rules changed and no playback writes
were added. This distinction avoids claiming provider guarantees without rules
access. Future query/data-layout changes need live rule compatibility checks.

TDD: both new chat suites first failed on missing implementation; a later
malformed-name case failed before its narrow normalization fix. Current tests:

- Vitest: 52 passed, comprising 32 unit and 20 integration tests.
- Playwright: 10 passed, 2 existing Windows WebKit media skips. All eight real
  App host/member profile cases now also exercise failed send, retained focus
  and draft, generic errors, successful retry and exactly one rendered message.
  Member cases seed 75 records and confirm only the latest 50 are displayed.
- Production build, focused ESLint and whitespace pass. Whole-project ESLint
  remains at 57 existing errors and 6 warnings, down from 59/6 after extracting
  the old send handler. No unrelated lint cleanup was performed.
- Screenshots cover desktop 1536x1024/1440x900 and 390px-wide Chromium/WebKit
  mobile; retry/error and successful-history views were inspected. Browser
  plugin is unavailable, so regular Playwright is the validation fallback.

### Approved development dependency remediation

Vite's required floor is now ^7.3.7; compatible lockfile refreshes resolve the
previous high-severity findings without Vite8/Tailwind4 migration or overrides.
Production dependency versions are unchanged. Clean installation with
`npx --yes npm@11.6.2 ci --ignore-scripts` passed, followed by all checks above.
Three CSS pipeline regression checks cover Tailwind's unescape helper, nesting,
responsive/hover/arbitrary variants and @apply.

Audit before: 17 affected packages (12 high, 4 moderate, 1 low). Audit after:
3 moderate rows, 0 high, 0 low; production audit: 0. The remaining rows are one
selector-parser advisory propagated through Tailwind/PostCSS Nested. Both
installed parser copies are 6.1.5, which the [maintainer explicitly lists as
patched](https://github.com/postcss/postcss-selector-parser/security/advisories/GHSA-rj75-hqrm-r3gf).
npm's aggregated range misses that backport. Source inspection confirmed the
Set-based fix; bounded local parsing of 100000 flat classes took 125ms/111ms
through the two installed consumers, alongside ordinary selector controls.
The discrepancy is documented, not suppressed. Recheck registry metadata later;
do not claim npm audit returned zero or force a framework migration to hide it.

An independent pre-patch boundary investigation and one fresh candidate review
found no concrete surviving dependency bypass/regression. Local post-feature
security checks identified no newly confirmed chat vulnerability. Deployed
Firebase enforcement, real media providers and actual iPhone behavior remain
unverified. No deployment, commit, push or additional security fixes occurred.

## Phase 8.4: transient room reactions

Implemented locally on 2026-10-25; not deployed. Like, Love and Applause use
restrained Lucide icons and labelled controls. A politely announced player
overlay shows up to four current reactions; each expires after five seconds
without requiring another database event. Peer names remain escaped React text
and are limited to forty characters. Unknown kinds, malformed names/timestamps,
expired events and timestamps over one second in the future are ignored.

Reaction sends append only to `rooms/{roomId}/reactions/{pushId}`. They use
send-time timestamps adjusted by the existing Firebase server-time offset, so
queued events that arrive after their lifetime are not shown as new reactions.
Known-offline sending is disabled; duplicate pending sends and repeated clicks
within one second are blocked locally. Failed sends show a generic message and
can be retried deliberately after the cooldown. Leaving, changing rooms and
StrictMode cleanup isolate old acknowledgements and clear local timers.
No playback/reference-clock writes were added.

This milestone provides presentation expiry and bounded visible UI only.
Stored reaction records are not pruned. The existing full-room subscription
still transfers the room history, including reactions; it does not establish
bounded database storage, bandwidth or server-enforced throttling. Real
multi-client Firebase delivery and physical iPhone playback were not exercised
by the local fixture tests. Use [Firebase's list-data documentation](https://firebase.google.com/docs/database/web/lists-of-data)
when planning a separate query/retention change.

TDD: the new unit and integration suites failed on missing implementation before
code was added. Verification: 39 unit tests and 22 integration tests passed;
Playwright passed 10 cases with the same 2 Windows WebKit codec skips. All eight
App host/member profile cases exercise reaction send, escaped peer delivery,
expiry, offline disabling, failed send/retry and unchanged playback fields.
The production build and focused ESLint passed. Screenshots were saved outside
the repository and desktop/mobile layouts were visually inspected. Browser
plugin not available; regular Playwright was used.

Before this feature, Firebase CLI/MCP access and the Netlify site association
were verified. Reading deployed rules confirmed unconditional read/write
grants under `/rooms/$roomCode`, and an anonymous read of a random nonexistent
room returned HTTP 200 with null. No live write probe was performed. The user
explicitly deferred that security issue; no rules, deployment or security fixes
are part of this milestone. Security review results are reported separately.

## Phase 8.5: invite sharing and room-entry recovery

Implemented locally on 2026-10-25; not deployed. Copy invite now waits for the
clipboard promise before confirming success. A failed or unavailable clipboard
shows a labelled, readonly, selectable invite link, and Copy invite remains
available for deliberate retry. Share invite invokes the device's share API
directly from the click when available, otherwise attempts copy. Cancellation
is quiet; other share errors show manual copy. Feedback says "Share options
opened" rather than claiming delivery to a recipient. See the browser API
semantics for [sharing](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
and [clipboard confirmation](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).
Pending actions reject duplicate clicks. Room/link changes and unmount clear
old feedback timers and prevent late acknowledgements from updating a new room.

Invite URLs use the current origin/path and only room/secret query parameters.
Room codes, full HTTP(S) invites and legacy query-string invites share one
parser. Room IDs are normalized and checked before Firebase access; malformed
links show inline feedback. An initial page invite's secret is reused only for
its original room. An explicitly pasted link supplies its own secret, including
an empty one; changing to a different room code does not carry the old secret.
Pasted URLs are parsed locally and are never fetched or navigated to.

Create, join and host-recovery errors now appear inline with generic provider
messages, retained fields, focus on the error and a retry path. A synchronous
request lock prevents duplicate entry operations, while name/room editing is
disabled during a request. Successful creation keeps recovery metadata in
memory immediately; localStorage read/write/removal failures do not prevent
entry. If storage is blocked, that in-memory recovery lasts only until reload.
The existing host-name/recovery checks and reference-clock normalization were
preserved. Media-load alerts are outside this slice.

TDD: all three new unit/integration suites first failed on missing modules;
the App browser entry test failed before the App wiring. The denied-storage
browser test then failed before the optional-storage handling was implemented.
Verification passed: 51 unit tests, 25 integration tests, production build,
focused ESLint, and 30 Playwright cases with the same 2 existing Windows WebKit
codec skips. Tests cover copy confirmation/failure/retry, manual selection,
native-share call/cancel/error, malformed/missing invites, provider entry
failure/retry, pending-request duplication, host recovery, denied storage,
secret scoping and unchanged playback fields. Desktop/mobile Chromium/WebKit
screenshots were visually inspected outside the repo. Browser plugin not
available; regular Playwright was the fallback. Browser APIs/provider traffic
were replaced with controlled fixtures: actual OS share sheets, recipient
delivery, real Firebase/Google behavior and physical iPhones remain unverified.

Focused post-feature source review and local adversarial checks covered URL
scheme/path handling, encoded secrets, room/async feedback isolation, manual
link text rendering, raw-error suppression and write destinations. No newly
confirmed vulnerability was identified within those checks. The existing High
Firebase room read/write finding remains deferred by the user; no rules,
security fixes, deployment, commit or push occurred.

### Integration coverage follow-up

The earlier totals were independent: all 51 unit tests and all 25 integration
tests passed; 25 was not a partial result out of 51. Six additional integration
cases now cover pending clipboard UI and duplicate actions, quiet share
cancellation, unavailable browser APIs, old-room failure isolation, and create
and rejoin form recovery. Current totals are 51/51 unit and 31/31 integration
tests passing (82 total). This follow-up changes tests and these notes only;
production behavior and the deferred Firebase security issue are unchanged.

## Phase 8.6: media submission feedback and retry

Implemented locally on 2026-10-25; not deployed. The video-link control is now
a labelled form with Enter-key submission. Empty, unsupported and malformed
links show inline feedback instead of blocking alerts. Load and Google Drive
authorization requests share a synchronous pending guard; the link, Load,
Authorize, screen-sharing and playback controls cannot start conflicting local
actions while the request is pending. Leave room remains available. A failed
submission retains the link, focuses its associated error and permits a
deliberate retry. Authorization still starts synchronously from the user gesture;
rejected authorization promises are handled with actionable, generic feedback.

"Video added to the room" follows acknowledgement of the room write. It does
not assert that a provider delivered media or that playback/decoding succeeded.
Video selection, the paused reference clock and its system announcement now use
one multi-location Firebase update, avoiding partial publication and duplicate
announcements on retry. Existing message history is preserved. Previous adapter
teardown waits for acknowledgement and checks adapter identity before retiring
it; deliberate same-video reloads remount the adapter. Existing source-change
effects retain resource cleanup ownership. The local fixture verifies that a
rejected replacement leaves the prior adapter active. Actual Firebase optimistic
events and permission rollback have not been validated against a live project.

Room changes and unmount invalidate pending feedback and post-authorization
continuations. An already-submitted database write cannot be cancelled by
leaving: it may finish in its original room, but it cannot set this client's
next-room video or feedback. No room schema, rules or host/member permissions
were changed. Drive download/stream retry, decoder errors, automatic recovery
and two-client synchronization remain separate work.

TDD evidence: both new suites first failed on the missing hook, all five new
Room integration cases then failed before UI wiring, and the real-App browser
case failed before App wiring. Verification:

- `npm run test:unit`: 58/58 passed, including 7 new request lifecycle tests.
- `npm run test:integration`: 36/36 passed, including 5 new hook-to-Room cases.
- `npm run test:e2e`: 42 passed, 2 existing Windows WebKit H.264 codec skips.
  The 12 new cases cover invalid links, rejected/delayed writes, duplicate
  submission, retry, preserved message history, adapter replacement/reload and
  completion after leaving across all four Chromium/WebKit profiles. Those
  12 cases passed again after the final adapter identity guard and additional
  malformed-input checks.
- Production build, focused ESLint and `git diff --check` pass. Whole-project
  lint still fails with 47 existing errors and 6 warnings (previously 48/6).
- Desktop 1440x900, Chromium mobile 390x844 and WebKit iPhone-profile layouts
  were exercised; desktop/mobile failure screenshots were visually inspected.
  Browser plugin not available; regular Playwright used the existing loopback
  server on `http://127.0.0.1:5175`. Page identity, meaningful content, framework
  overlays, console health, layout overflow and target interactions passed.

Firebase and YouTube boundaries use controlled browser fixtures. Google consent
and its completion are represented by controlled operations in unit/integration
tests. Live Firebase acknowledgement/rules, Google OAuth consent, YouTube/Drive
availability, actual OS popups and physical iPhone playback are not established.
No new dependency, cloud configuration, deployment, commit or push was needed.
Pre-existing workspace changes and protected proxy-file hashes were preserved.

Focused post-feature security review and non-destructive local adversarial
checks covered unsupported/malformed links before writes, repeated requests,
provider-error suppression, escaped feedback, room/session isolation and the
generated announcement write path. No newly confirmed vulnerability was found
within this scope. The previously reported High finding for unconditional
Firebase room reads/writes remains deferred by the user; no security fix or
live data probe was performed for this slice. This is not a full security audit.

## Phase 8.7: retry failed Drive preparation

Implemented locally; not deployed. Failed Google Drive stream preparation or
downloads offer a labelled Retry video button in the player. Retry uses the
current room and selected file without publishing another selection, resetting
the reference clock or posting another room announcement. Pending retries share
the media-request lock and show preparation status; leaving remains available.
Known-offline retries are disabled. Download mode offers Authorize when OAuth
access is unavailable, and the existing token-change effect resumes preparation.

Source, room, authorization and presence changes cancel obsolete requests.
Cancelled responses cannot replace current download metadata or clear current
authorization. Unmount aborts downloads and releases their object URLs. A host's
initial playback event after recovery follows the current room clock without
republishing it; subsequent host controls and terminal video events keep their
existing publication behavior.

Retry is explicit after a preparation failure. Existing streaming behavior can
also request a new ticket when presence reconnects. Decoder failures, expired
media URLs after successful preparation, automatic backoff and real multi-client
provider validation remain separate work. Local fixtures do not establish live
Firebase/Google behavior or physical iPhone support. The previously reported
Firebase room-rules security finding remains deferred; no cloud configuration,
security remediation or deployment is part of this slice.

## Phase 8.8: actionable player failures

Implemented locally on 2026-10-25; not deployed. YouTube unavailable/private,
embedding-restricted, invalid-link and player-identification failures now show
useful inline messages. Native Drive decode/unsupported-format errors suggest
MP4/H.264. Permanent failures do not start automatic retry loops. New playback
messages use fixed text rather than raw provider errors, URLs or ticket values.
Error mapping follows the official [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
and [MediaError codes](https://developer.mozilla.org/en-US/docs/Web/API/MediaError/code).

## Phase 8.9: playback and expired-ticket recovery

Transient playback failures retry after 1, 2 and 4 seconds, then offer manual
retry. Successful playback resets the consecutive-failure budget. Drive stream
tickets renew 30 seconds before their millisecond expiry. Routine renewals while
paused do not consume failure retries. Player readiness has a 10-second deadline;
successful ticket preparation alone does not confirm player recovery.

Recovery remounts the selected adapter and follows the current room reference
clock without publishing a new selection, announcement or host playback anchor.
Download mode reuses the retained blob. Old source/room callbacks and offline
request completions cannot restart recovery timers. Retry is disabled while
transport or required authorization is unavailable.

## Phase 8.10: screen-share lifecycle and reconnect

Screen capture starts synchronously from the click gesture. Inline permission,
capture and connection feedback replaces blocking alerts. Pending capture blocks
duplicate starts; capture denied/cancelled before publication preserves the video
and clock. Late capture after leaving is stopped. Viewer autoplay can fall back
to muted playback with explicit Unmute/reconnect guidance.

Either a host or member may share. Viewers request the active broadcast on late
join and reconnect. Answers are stored per viewer; broadcast and connection IDs
separate obsolete offers, answers and ICE. Early ICE is drained only into its
matching connection. Unanswered requests/negotiation time out after 10 seconds,
with bounded 1/2/4-second reconnect attempts and an explicit disconnected state.
Tracks, peers, subscriptions and retry timers are released on cleanup.

The user explicitly approved the screen-share ownership correction: viewers
receive Reconnect rather than Stop sharing; viewer leave/reconnect does not clear
the broadcast. An owner claims a broadcast atomically and stops it conditionally
using both owner name and broadcast ID. Old stop acknowledgements cannot discard
new local ownership. These client safeguards do not replace Firebase rules.
Existing clients should reload together before any rollout: old single-answer
writers can overwrite the new per-viewer answer subtree. No rollout occurred.

Microphone voice chat is **not implemented**: there is no microphone capture,
mute control for a microphone, or speaking indicator. Screen capture requests
shared audio only when the browser/source supports it. No TURN relay was added.

### Verification for 8.8-8.10

- TDD: missing-module/UI tests failed before implementation. Additional failing
  tests reproduced offline completion timers, paused-renewal retry exhaustion,
  stale ownership acknowledgements, early offers before transport readiness,
  unanswered requests and YouTube host recovery changing the shared clock.
- `npm run test:unit`: **93/93 passed**.
- `npm run test:integration`: **50/50 passed**. Includes three real hook/Room
  clients sharing a member-owned stream, late joins, reconnect and viewer leave.
- `npm run test:e2e`: **86 passed**, with **2 existing Windows WebKit H.264
  codec skips**. The final request-timeout change then passed all **12** affected
  screen-share cases again across the same four Chromium/WebKit profiles.
- Download mode (`VITE_DRIVE_STREAMING=false`): **28/28 browser cases passed**;
  streaming-only ticket renewal was excluded from that run.
- Production build passes. New hooks, failure mapping, Room and test files lint
  clean. Whole-project lint retains **25 existing errors and 5 warnings**, down
  from 47 errors/5 warnings before this work; unrelated lint debt is not fixed.
- Desktop and mobile error/reconnect screenshots were visually inspected. Error
  text wraps without document overflow; meaningful content, page identity,
  console health and target interactions were checked. Browser plugin not
  available; the existing regular Playwright workflow was used.

Provider SDK, capture and WebRTC boundaries use controlled local fixtures. The
three-client test validates signaling/control behavior, not real ICE transport
or media delivery. Live Firebase/Google, real OS capture/audio selection, cross-
network NAT traversal, physical iPhone behavior and mixed-version clients remain
unverified. Protected proxy hashes and pre-existing work were preserved. No new
dependency, cloud configuration, deployment, commit or push was needed.

### Focused security review and local penetration checks

Manual before/after review covered the changed production paths, escaped fixed
feedback, duplicate operations, permission failure, stale completion/room
isolation, owner/viewer controls, conditional stop, per-viewer signaling and ICE
session matching. The formal security plugin scan was not launched: its Git
baseline options would include unrelated prior dirty work; saved preimages and
the starting hash inventory were used for this focused review instead. No sealed
plugin scan report or comprehensive security claim is made.

- **Medium, new, unresolved — unbounded requests from absent participants.**
  `src/hooks/useWebRTC.js`, `/rooms/{room}/webrtc/requests/{sharer}/{viewer}`:
  the request handler checks claimed sender/session but does not check online
  membership or cap new peers. A fixture-only probe submitted 12 distinct absent
  names with the current broadcast ID; all 12 allocated peer connections with
  capture tracks attached. A signaling writer can consume the sharer's browser
  resources/bandwidth; completing media reception was not tested. Suggested fix:
  validate authenticated membership in rules, reject names outside the current
  participant set, and bound/rate-limit pending peer creation. **Reported first;
  no remediation applied pending user approval.** The probe used mocked Firebase
  and RTCPeerConnection only; its temporary test was removed after restoring the
  exact source bytes.
- **High, previously reported, deferred — unconditional Firebase room access.**
  Previously inspected deployed `/rooms/$roomCode` rules allow unconditional
  reads/writes. Room data and signaling integrity remain exposed to clients with
  a room path; client owner checks can be bypassed with direct writes. Suggested
  fix: authenticated membership and owner-bound rules with rejection tests.
  Rules were not re-probed or changed in this work. Approval for the client
  ownership correction does not authorize this separately deferred rules fix.

## Phase 8.11: approved Firebase and signaling security fixes

Implemented locally on 2026-10-25 after the user approved remaining items 1, 2
and 3. Production rules, app and media proxy have **not** been deployed. The
previously reported High deployed-rules exposure is therefore **not closed in
production**. Firebase MCP registered the project's first web app and retrieved
its public SDK configuration; the client key is stored locally without printing
it. No live room data was read or modified for this implementation.

The browser now uses Firebase anonymous authentication with a persisted UID.
Private room enrollment requires a full invitation for a first-time visitor;
code-only re-entry works for the same UID's existing grant. The private
`roomAccess/{room}/{uid}` grant checks the invitation on the server. Six fixed
seat keys bound to UIDs limit reserved identities; names are then bound to those
UIDs in `rooms/{room}/identities`. A name collision can be corrected before its
claim; a claimed name cannot be reassigned or stolen. Sparse Firebase seat
arrays and simultaneous same-UID claims are handled. Seats remain reserved when
leaving for safe re-entry: rotating a full six-person guest list requires a new
room. This does not implement account transfer or cross-device host recovery.

`database.rules.json` denies access by default and has no broad write grant for
an existing room. It rejects unauthenticated/nonmember reads, forged enrollment,
host takeover, secret/identity changes, ancestor replacement/deletion, unknown
sibling fields, cross-room access, other users' presence, forged message/reaction
authors and unauthorized signaling. Host playback/presence authority is bound to
`hostUid`; members may still select a video through an atomic paused selection.
Message/reaction writes carry the sender UID. Host recovery requires the creator
UID, not a localStorage name. Crypto-unavailable creation fails closed rather
than generating a predictable invitation.

Screen ownership moved into `screenShare` with owner UID and broadcast ID. An
atomic child-authorized update claims it and clears the previous media clock;
an owner releases only a matching broadcast. This avoids whole-room transaction
permissions. Offers, answers, requests and ICE are sender/recipient/session
bound. The client rejects absent participants at the common peer boundary,
limits peers to five, ignores request bursts while negotiating, and bounds ICE
queues/deduplication. Sender-scoped ICE slots 0-31 bound stored candidates; an
old connection cannot poison the new connection's deduplication state.

Drive ticket preparation now passes the caller's Firebase ID token. The media
proxy submits that exact token to Firebase, without an administrator-credential
fallback, then binds its verified UID to the requested active participant. Room
secret and current-file checks remain. A disconnected participant cannot mint a
new ticket. This requires a coordinated proxy/client/rules release. Existing
bearer tickets retain their established expiry behavior.

## Phase 8.12: opt-in microphone voice chat

Voice is implemented locally. Join voice requests audio directly from the user
gesture; mounting a room never requests microphone permission. Controls include
Mute/Unmute microphone, Leave voice, Reconnect voice and explicit audio enabling
when browser autoplay is blocked. Pending capture blocks duplicates; permission
and device failures are inline and sanitized. Late capture is stopped after
leaving. Going offline stops capture and requires deliberate rejoining.

Up to six opted-in participants use a bounded WebRTC audio mesh. UID-bound voice
presence, separate per-sender signaling, session/connection IDs, deterministic
offer direction, early ICE handling, negotiation deadlines and bounded retries
handle joining and reconnecting. A pending request cannot create a write/room-
update loop. Old disconnect markers are scoped to their microphone session and
cannot remove a newer session. Leaving immediately disables local capture before
waiting for database acknowledgement and releases peers, remote audio elements,
timers and AudioContext resources. Shared video playback remains independent.

Local audio analysis publishes only speaking-state transitions; microphone mute
disables actual audio tracks and suppresses speaking indicators. No microphone
recording/upload service or TURN relay was added. Clearing browser identity can
lose host recovery; a full account/recovery system remains separate work.

### Verification for 8.11-8.12

TDD reproduced the original open-policy failures in the real Firebase emulator,
the absent-participant connection allocation, missing voice/UI behavior, sparse
seat enrollment, early ICE/request-loop errors, caller-token omission and the
crypto fallback. Independent read-only investigation and one candidate review
challenged authorization and compatibility. Its confirmed ICE deletion and
nullable-seat regressions were corrected with focused proofs. A native-browser
test additionally caught and corrected host disconnect pre-registration: rules
permit partial offline cleanup to be armed before the full online node exists.

- `npm run test:unit`: **119/119 passed**.
- `npm run test:integration`: **53/53 passed**, including three voice clients
  exchanging simulated remote streams, late joins, mute/speaking and cleanup.
- `npm run test:rules`: **15/15 passed** using actual Auth/Realtime Database
  emulators with project `demo-watch-party`. Includes real anonymous sign-in,
  authenticated positive controls, rejected writes/reads, bounded seats/ICE,
  safe disconnect cleanup and member screen claim plus media reset.
- `npm run test:e2e`: **102 passed**, with the same **2 existing Windows WebKit
  H.264 codec skips**, across desktop/mobile Chromium and WebKit profiles.
- `npm run test:rtc`: **1 passed** with actual native Chromium WebRTC, synthetic
  microphones, real Auth/Database emulators and the restrictive rules in the
  exact database namespace. Both clients received audio RTP bytes; mute changed
  the actual track and leave ended capture. Anonymous room reads returned 401
  and an authenticated member's host-UID change was rejected. The test uses
  local ICE candidates with external STUN disabled and blocks other providers.
- Download mode: **28/28 browser recovery checks passed**, excluding the four
  streaming-only ticket-renewal cases.
- `media-proxy/npm test`: **3/3 identity tests and 38/38 existing integration
  checks passed**, including token forwarding, identity mismatch, disconnected
  participation, streaming/range behavior and log redaction.
- Production build passes. Changed hooks/components/tests lint clean; whole
  project lint retains **25 existing errors and 5 warnings**.

The emulator SDKs are development dependencies; production retains the existing
Firebase CDN SDK version. Java 21 is required for Firebase CLI emulators. A
checksum-verified portable Java runtime was installed outside the repository in
the user's `.codex/tools/watch-party-jre21` directory and used through per-process
JAVA_HOME/PATH; global Java 11 was not changed. Point JAVA_HOME at Java 21+ before
running the emulator npm scripts. The Node rules command exits after its tests
and cleanup because Firebase Auth refresh handles otherwise keep it alive.

Browser plugin not available; regular Playwright used the existing loopback
workflow. Desktop/mobile permission and connected-voice screenshots were
visually reviewed. Main UI/provider tests use fixtures; the separate RTC case
uses real SDKs/media transport locally. These do not establish live Firebase
rules enforcement, production Google/Drive behavior, actual microphones,
cross-network NAT traversal, Safari capture/audio policy or physical iPhones.

### Rollout and remaining findings

Release the compatible media proxy and frontend, public Firebase client key,
Firebase anonymous sign-in configuration and database rules as one coordinated
change. The Netlify site association exists, but the local proxy setting points
at localhost; confirm a reachable production proxy URL before release. Deploying
only the rules would break the currently deployed unauthenticated client.
Legacy rooms have no trusted creator UID and must be recreated with fresh
invitations; stored names cannot authorize ownership migration. Old data was
preserved. Reload all clients after release. Do not roll back by restoring open
read/write rules; retain the private policy while reverting compatible UI/proxy
versions, or temporarily deny room operations during recovery.

Post-feature review and non-destructive local adversarial checks found:

- **Low, existing, unresolved — orphaned screen-share ownership after abrupt
  owner exit.** `src/hooks/useWebRTC.js` releases local tracks on unmount but
  does not register session-scoped server disconnect cleanup for `screenShare`.
  A local hook probe confirmed the broadcast record survives owner unmount;
  after a reload the new hook lacks its in-memory broadcast ID and cannot offer
  the existing Stop action. This can block a later share until a new room is
  created. Suggested fix: session-scoped disconnect expiry and safe recovery by
  the authenticated owner. This pre-existing lifecycle issue is outside the two
  approved finding boundaries and was **reported without remediation**.
- **Dependency advisory, application reachability unproven.** `npm audit`
  reports **5 high and 3 moderate** advisories in the development dependency
  tree, including the test Firebase SDK's unused Firestore/gRPC packages and
  existing Tailwind dependencies. The production bundle uses CDN Auth/RTDB,
  and no gRPC server or Firestore execution path was established in this review.
  Suggested follow-up: review compatible upstream fixes/overrides and test the
  tooling changes separately. No automatic audit fix was run.

The two approved findings no longer reproduce in their local client/emulator
tests. Production's original High finding remains open until the coordinated
release. No other confirmed application vulnerability was identified within
this bounded review; no comprehensive-security claim is made. No deployment,
commit, push, live room probe or unrelated security remediation occurred.

## Phase 8.13 - Coordinated release and application QA (2026-10-25)

The preceding rollout section records the earlier local-only checkpoint. The
compatible frontend, media proxy, anonymous Firebase sign-in and private database
rules are now released. Production is https://partyapp-fun.netlify.app, Netlify
deploy `6addb99d3bb538b55302b940`, Cloud Run revision
`party-media-proxy-00007-mop` at 100% traffic. Live HTML matches the local build.
Reload clients and create fresh rooms/invites; old unauthenticated rooms were
preserved and cannot safely inherit creator identity from stored display names.

Approved fixes and QA improvements:

- Screen-share v2 records carry a unique connection marker. Server disconnect
  cleanup is armed before publishing; inactive records can be replaced without
  allowing viewers or delayed cleanup to clear a newer broadcast. Client display
  state and signaling rules use the same active-session boundary. A legacy
  authenticated owner can explicitly stop an old share after reload; mounting or
  closing another tab does not automatically clear it.
- Development gRPC is pinned to patched 1.13.6. Selector parser is pinned to the
  maintainer's patched 6.1.5 backport, preserving Tailwind 3's CommonJS helper.
  Parser 7 was rejected after a compatibility regression test failed. The npm
  registry still reports three moderate entries because its affected range
  disagrees with the maintainer advisory; this is not a clean audit result.
- Live QA reproduced an enabled Play control before YouTube was ready. Host
  transport now shows disabled "Preparing player..." until adapter readiness.
  Unit, adapter/component integration and four browser profiles cover it. A live
  rerun confirmed real YouTube time advancing and host Play/Pause clock changes.

Final local checks: **126 unit**, **56 integration**, **17 Firebase rules**,
**1 native WebRTC journey**, **106 browser checks**, **28 download-mode browser
checks**, and **41 proxy checks** passed: **375 passed, 2 Windows WebKit H.264
skips**. Production build, scoped lint and whitespace checks pass. Whole-project
lint retains **24 existing errors and 5 warnings**, down one unused-player error
because readiness now uses that state. Production frontend dependency audit is
clean; proxy dependency audit reports two moderate uuid/gaxios entries, whose
affected buffer APIs were not found on the observed gaxios v4-only path.

Production checks: **15 UI journeys**, **10 proxy authorization/error checks**,
and **3 native fullscreen/quality/video-mute checks** passed. These use actual
Firebase SDK/CDN, Auth, database rules, Netlify, Cloud Run and native Chromium
WebRTC. Voice uses synthetic microphones; screen capture uses a canvas stream.
Both clients received real audio RTP and the screen viewer decoded video frames.
Abrupt owner-tab exit, reconnect, microphone cleanup and host recovery passed.
Live WebKit entry and desktop/mobile layouts were checked. Five disposable QA
rooms, their grants and eight test anonymous accounts were removed; unrelated
room data and protected workspace files were preserved. No commit or push.

New findings are reported for approval, without remediation:

- **Medium:** unauthenticated production `/api/logs` returns client IPs and
  operational request/room details (`media-proxy/server.cjs`). Disable it in
  production or restrict access to administrators.
- **Advisory, application reachability unproven:** proxy production dependencies
  include uuid below 11.1.1 through gaxios. Review a compatible upstream update;
  the vulnerable v3/v5/v6 buffer APIs were not found in the observed caller.
- **Low hardening:** proxy Dockerfile still uses Node 20, which the official
  release table lists as end of life. Move to a supported LTS after compatibility
  and container verification.

Remaining acceptance gaps: an accessible shared Drive movie for real live Range
playback/seek/renewal, physical microphones and OS capture picker, physical iOS,
cross-network NAT/TURN, and quantitative multi-client drift/load testing. A
deliberately nonexistent Drive file obtained an authorized ticket and failed
safely; upstream 404 currently becomes 502 and should be classified as permanent
unavailability in a later reliability change. No whole-application security
guarantee or physical-device claim is made.

## Phase 8.14 - Approved proxy security follow-ups (2026-10-25)

The user approved the three findings reported at the 8.13 checkpoint. They are
now remediated and released as Cloud Run revision `party-media-proxy-00009-vib`
at 100% traffic. Both `qa20261025` and `security20261025` tags point to the fixed
revision, so the old QA URL cannot continue serving the vulnerable log route.

- Production `/api/logs` returns 404 for GET, HEAD, POST and query variants;
  spoofed Origin/Authorization/forwarding headers do not enable inspection.
  Internal redacted diagnostics and stdout logging remain available. Development
  inspection, `/health`, `/status` and the media/ticket contracts remain intact.
- The proxy image now uses Node 24 Alpine, verified as v24.22.1. Its unprivileged
  `node` user is retained. The deployed platform manifest matches the tested
  container configuration. Package engines now require Node 22 or newer.
- Google Auth moved from 9.15.1 to 10.9.1. Its upstream gaxios 7 dependency no
  longer includes UUID. A clean install and production audit pass with zero
  findings. The original UUID advisory had unproven application reachability;
  removing it from the dependency tree does not imply a prior exploit.

TDD first reproduced the production disclosure, old image runtime and vulnerable
dependency tree. New direct-handler unit tests, actual HTTP integration and a
real Google Auth RSA-signed token exchange through a loopback endpoint now pass.
The exchange also verifies Drive-only scope, token parsing and cache reuse. One
fresh read-only investigator and one candidate reviewer found no surviving
concrete bypass or regression after the changes.

Verification: **6 proxy unit tests**, **2 new integration tests** and **38 existing
proxy checks** pass on local Node 22 and again inside the Node 24 image. Frontend
**126 unit**, **56 integration** and **32 Drive browser checks** pass. The tagged
candidate passed **16 live integration checks** before promotion; production then
passed the same **16**, plus **20 log-denial/health checks** across numeric,
canonical and both tagged service URLs. Authenticated ticket issuance and safe
media rejection still work. Existing environment and service-account settings
were preserved. Two temporary QA rooms/grants and two test accounts were removed.
Protected pre-existing files and empty Git indexes were preserved; no commit or
push was made.

No additional confirmed security finding was identified in this bounded review.
Container OS vulnerability scanning, real shared-Drive movie playback, physical
capture/iOS, cross-network NAT/TURN and the earlier lint/registry limitations
remain outside this fix's proof. No frontend or Firebase-policy redeploy was
required for this proxy-only release.

## Phase 8.15 - Persistent voice and fullscreen mobile chat (2026-10-25)

Voice now retains explicit opt-in and mute during signaling interruptions,
automatically renews registration and retries peers with bounded backoff. A
transient disconnect gets a grace period. Actual browser-ended capture requires
an explicit Resume gesture; Leave and room teardown stop the microphone. Capture
requests echo cancellation, noise suppression, automatic gain control and mono
audio. Input level, connected-peer count and measured RTT/network feedback are
visible in the room.

New chat messages pop over the video with an unread count. Users can read, send
and retry messages within the viewing stage. Initial room history is seeded
before rendering, and new-message notifications use IDs instead of comparing
sender/viewer clocks. The application's fullscreen controls keep chat available;
Android keyboard resize switches to an immersive visual-viewport-sized stage.
Android Chrome on the attached CPH2455 lacks getDisplayMedia and receives viewing
guidance. Desktop broadcast and native Android receiving both work. The user
subsequently clarified that phone broadcasting is also a desired product goal;
native Android/iOS capture was not added in this release.

TDD reproduced the old disconnect, retry and fullscreen-chat behavior before
implementation. The physical phone exposed a keyboard sizing bug, and a release
candidate exposed a message-clock bug; both received failing regressions first.
Final checks: **139 unit**, **61 integration**, **19 Firebase rules**, **1 native
RTC journey**, **114 browser**, **28 download-mode browser**, and **46 proxy**
checks passed: **408 total**, with **2 existing Windows WebKit H.264 skips**.
Production build, scoped lint and whitespace checks pass. Whole-project lint
still has **24 existing errors and 5 warnings**.

Eight physical checks passed on CPH2455 / Android 14 / Chrome 155 against the
local frontend with deployed Firebase, and the same eight passed against the
production site. The actual phone decoded native WebRTC video, received a
fullscreen popup, replied with its software keyboard open, exchanged microphone
RTP, recovered automatically after signaling loss without recapture while
preserving mute, stayed connected for a 60-second soak, and ended capture on
Leave. The desktop microphone and screen source were synthetic; this proves
transport, not subjective acoustic quality or long-term/background reliability.

The bounded security review discovered that deleting a member's roomAccess
grant left established voice media running. The finding was reported first and
the user explicitly approved its fix. Own-grant validation now stops revoked
capture; peer creation/signaling require a conditionally readable admission-name
leaf, whose Firebase rule checks both parties' grants and identity bindings.
Peer denial closes the honest endpoint even if the revoked client ignores its
own errors. Cross-UID grant objects and secrets remain private. Real emulator
listeners, hostile-client native RTC and two live checks against both local and
production frontends prove closure. Separate read-only investigation and one
candidate review found no further concrete bypass in that boundary. Reusable
invitations still permit fresh room enrollment; this is not a permanent ban.

Firebase database deployment job `1792935910360` succeeded. Candidate Netlify
deployment `6ade07f20c57a222b6504116` passed seven live checks before its tested
assets were published as `6ade087dac898286a60ea518` at the production URL.
Fourteen disposable rooms/grants and 21 fresh QA accounts were removed; existing
phone identities, protected proxy files and pre-existing workspace work were
preserved. Owned device forwards and the test server were cleaned up. No commit
or push. Detailed commands, evidence and limits: [Mobile voice QA](MOBILE_VOICE_QA.md).

Remaining limits include real shared-Drive movie playback, physical desktop
capture-picker proof, acoustic/echo quality, multi-hour/background testing,
physical iOS and cross-network NAT/TURN. The voice configuration has STUN but no
TURN relay. Existing clients must reload to receive the client-side changes.

## Phase 8.16 - Native Android screen broadcast (2026-10-26)

Added `android-broadcaster`, a native Android companion for the existing web
rooms. Android MediaProjection consent and a foreground service send screen
video over native WebRTC. Users paste a full private invite and choose a distinct
broadcaster name; existing Firebase UID-bound admission and six-seat rules apply.
The app protects its private invite controls from capture, supports viewer
reconnect and provides notification/app Stop. It does not implement device
playback audio, native voice or iPhone broadcasting. Android Chrome remains a
viewer; phone broadcasting uses the installed companion.

TDD and physical testing exposed and fixed numeric-key Firebase array handling,
configured-database reuse, late signaling during peer backoff, notification
navigation and cold-cache transaction cleanup. The cleanup regression failed
against real native Firebase SDK/emulators before the fix. It now retries the
initial null transaction value while retaining owner UID/session checks.

Final checks: 6 native local unit tests; 4 real native SDK integration tests and
1 instrumented intent test on CPH2455 / Android 14; 1 physical production capture
journey with all 4 browser coordination groups; 139 frontend unit tests, 61
frontend integration tests and 12 screen-share browser regressions passed.
Actual owned-screen pixels, receiver reconnect, a 60-second capture soak,
notification control navigation, explicit Stop and server-confirmed share cleanup
were verified. Native build passes; lint has no errors and one legacy backup
configuration warning. APK v2 signature and installed artifact hash verified.

Bounded source/runtime security review found no confirmed new vulnerability in
the checked boundaries. Invalid invite/competing owner/stale signal cases were
tested; external service start is rejected. Hostile native revocation, older OEM
backup behavior, native dependencies, prolonged operation and TURN/cross-network
connectivity remain unverified. No security finding was silently fixed.

The debug APK remains installed on the phone and is available under
`android-broadcaster/releases/`. Nine disposable QA rooms/grant collections and
nine fresh host accounts were deleted while preserving the native app account.
Test APK, projection and owned ADB reverses were cleaned up. Existing frontend,
rules, proxy work and protected hashes were preserved; no commit or deployment.
Commands, artifact hash, evidence and limits: [Android broadcast QA](ANDROID_BROADCAST_QA.md).

## Phase 8.17 - Playback, viewing library and participant features (2026-10-26)

Implemented the first three expanded web-roadmap items after the user clarified
that Android companion development should be held. No Android source/APK change
or production deployment is part of this checkpoint.

The shared playback helper adds gentle HTML5 drift correction, immediate member
reconciliation after buffering, duration/end alignment and invalid-clock handling
while preserving host authority, interrupted-host freezing and legacy fallback.
Provider callbacks clean up with their adapters; buffering does not cause seeks.

Home and Room expose a capped, browser-local continue-watching/history/wishlist
library. Saved positions create fresh paused rooms; the host can resume the
current selection through the existing guarded seek handler. Members retain
their existing media-load rights but cannot change the authoritative clock.
Progress is saved every five seconds and at lifecycle events; clearing history
preserves wishlist entries. Canonical media IDs are stored without original
URLs, room secrets, authorization tokens or playback tickets. Blocked storage
falls back to clearly labelled session-only use.

Participant avatar colours persist locally and publish to an authenticated,
member-owned room profile. Host/You identity labels remain stable. Typing uses
the tab's existing presence connection, contains no draft text, arms disconnect
cleanup and expires automatically. Notices appear in fullscreen and sidebar
conversation. Additive rules validate preset profiles and own live typing
connections with server-bounded timestamps.

Tests were added and observed failing before implementation, including later
behavioral refinements. Final local Vitest: 149 unit and 72 integration checks
pass. All 21 real Firebase rules tests and the real SDK/native RTC journey pass;
the latter now includes cross-client avatar and draft-free typing delivery.
Final full browser rerun: 122 passed with 2 existing Windows WebKit H.264 skips. Build and scoped
lint pass; whole-project lint retains 22 existing errors and 5 warnings.
Production dependency audit reports zero findings. The bounded security review
found no confirmed new vulnerability in these feature boundaries; no security
issue was silently remediated.

New frontend and rules remain local. Release requires rules before web assets.
No production data, proxy, Android APK, commit or push was changed. Details and
remaining coverage limits: [Web product QA](WEB_PRODUCT_QA.md).

## Phase 8.18 - Approved web release and live verification (2026-10-26)

The user approved deployment of Phase 8.17 while leaving Android development on
hold. Firebase database deployment `1792957574547` succeeded first and deployed
rules match the local tested file. Existing rules were unchanged outside the
additive profiles/typing branches.

Release checks added failing coverage for YouTube state events before readiness
and before initial bookmark alignment. The startup guard now prevents a provider
PAUSED event from publishing zero over the saved clock. Final local results:
150 unit, 72 integration, 21 rules and 126 browser checks pass, with 2 existing
Windows WebKit H.264 skips. The earlier real SDK/native RTC result is retained
from Phase 8.17; live release checks independently recheck native audio/video transport.
Production build and scoped lint pass; the known whole-project lint backlog
remains. No dependency or backend change was introduced.

Candidate `6adee5bf54010e82fefe04b5` passed 13 live checks. Its exact artifact was
published as Netlify production deployment `6adee6f67393f989dabd2c1b` at
https://partyapp-fun.netlify.app, then passed the same 13 checks on the main URL.
Live Firebase authentication/rules, avatars, timestamp-only typing, fullscreen
messages, wishlist/history persistence, real YouTube progress, new-room bookmark
restoration and host Resume were verified. Existing voice RTP/reconnect/mute and
screen-share video/Stop also passed. Synthetic microphones and owned canvas
capture prove transport; no physical device or acoustic claim is made.

All 13 published files match the release artifact. Production HTML contains a
known Netlify hosting comment; only that non-executable comment is normalized
for its hash comparison, with executable assets compared byte-for-byte. The
Netlify published-deploy pointer and Firebase rules readback were checked.

The bounded live security checks rejected foreign profile/typing writes and
unauthenticated reads against only newly created QA rooms. No confirmed new
security vulnerability was found. All 11 disposable rooms/grant collections and
13 fresh anonymous QA accounts were removed. Protected proxy files, pre-existing
workspace changes and empty indexes were preserved. No Android, proxy, commit
or push. Full evidence and remaining limits: [Web product QA](WEB_PRODUCT_QA.md).
