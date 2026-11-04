# Web playback, viewing library and participant QA

Date: 2026-10-26. These changes implement the first three items in the expanded
web roadmap. Android companion development is on hold and its source/APK are
unchanged. This report records local implementation and the production rollout
verified below. This task did not add new physical-phone testing.

## Playback improvements

The existing authoritative reference clock and legacy compatibility remain.
HTML5 playback gently corrects drift between 0.35 and 2 seconds with rates 0.97
or 1.03, returning to 1 when aligned, paused or buffering. Drift of at least two
seconds uses a seek. YouTube retains seek-based correction because its adapter
does not expose fractional playback rates.

Buffering never triggers repeated seeks. Actual recovery immediately reconciles
a member instead of waiting for the next five-second tick. A paused room still
pauses a buffering player. A network `stalled` event with adequate decoded buffer
does not falsely report buffering. Targets are clamped to known duration; the end
is aligned and paused instead of repeatedly trying to restart an ended video.
Invalid clocks are rejected and future anchors do not move playback backwards.

These corrections issue local player commands; members gain no authoritative
clock-write permission. Existing interrupted-host freezing, autoplay recovery,
media selection and screen-share behavior remain in place.

## Continue watching, history and wishlist

Home and Room now expose a viewing library. Choosing an unfinished saved video
on Home prepares the next room; Create Room creates a fresh private room paused
at that bookmark. Finished videos and new wishlist entries start at zero. Joining
an existing room keeps its current selection and clock.

In a room, users can load a library selection; the host can resume the current
saved video with the existing generation-guarded seek path. Members cannot use
Resume to alter the room clock. Standard Drive authorization still applies.

Progress is sampled every five seconds and saved on pause/end, page hide and
explicit Leave. History is capped at 50 normalized entries. Completion is marked
at 95 percent of a known duration. Wishlist entries survive clearing history,
while their viewing progress is reset. Users can remove wishlist entries.

This is a **browser-local library**, not account/cloud synchronization. Only
source, media ID, bounded title, position/duration, timestamps and library flags
are stored. Original URLs, room invitations, credentials and streaming tickets
are excluded. Supported links are canonicalized to HTTPS YouTube/Google Drive
identifiers. Corrupt entries are ignored. Blocked storage keeps the current
session usable and displays that persistence is unavailable.

## Participant features

Participants can choose one of four professional avatar colours. The preference
persists on this browser; room-visible avatar profiles are bound to the existing
authenticated name/UID. Stable room names and Host/You labels remain authoritative.
This does not add uploaded photos or rename an existing room identity.

Typing notices appear in the sidebar and fullscreen conversation. Only a server
timestamp is published, never draft text. Continuous typing is throttled to one
write per two seconds, stops after five seconds of inactivity, and is cleared on
empty draft, send, input/window blur, hidden page or room teardown. Each tab uses
its existing participant-presence connection key, arms server disconnect cleanup
before publishing, and removes only its own record. Receivers expire notices
after eight seconds, use the server-time offset and exclude self/offline/future
records. Late writes are cleaned up after teardown. Immediate restart after a
Stop is not accidentally suppressed by the throttle.

Firebase rules add only `rooms/{room}/profiles/{name}` and
`rooms/{room}/typing/{name}/{connection}` permissions. Both require valid room
admission and the exact authenticated identity. Profile values are fixed presets;
typing requires a live owned presence connection and server-bounded timestamps.
Unknown fields, foreign identities and nonmember reads are rejected. Validation
uses the [Firebase rules API](https://firebase.google.com/docs/reference/security/database).

## TDD and validation

New tests were run and observed failing before feature implementations. Further
red/green regressions cover buffering feedback, end alignment, false stalls,
immediate typing restart and preserving a custom library title. Initial missing
module failures, UI wiring failures and behavioral regressions are retained in
private local logs; failed attempts are not counted as passes.

| Command / check | Final result |
| --- | --- |
| Vitest `tests/unit` | 150 passed, including the release startup regression |
| Vitest `tests/integration` | 72 passed |
| Auth/RTDB emulators: `node --test --test-force-exit tests/rules/database.test.mjs` | 21 passed |
| Auth/RTDB emulators: Playwright `--config=playwright.rtc.config.js` | 1 real SDK/native RTC journey passed at the implementation checkpoint; live transport rechecked below |
| `npx playwright test --workers=2` | 126 passed, 2 existing Windows WebKit H.264 skips |
| `npm run build` | Passed |
| Scoped ESLint, excluding legacy App issues | Passed |
| Whole-project ESLint | 22 existing errors, 5 warnings; not a clean lint result |
| `npm audit --omit=dev --json` | 0 reported vulnerabilities |
| Live release candidate | 13 checks passed |
| Live production site | The same 13 checks passed |

The real SDK journey now proves another authenticated browser receives the
avatar and typing updates through actual emulator listeners, and verifies the
typing payload contains only `updatedAt`. Sending clears the notice. Existing
chat, reactions, voice, screen video, reconnect and hostile revocation checks in
that journey also pass. The rules suite confirms saved-position room creation,
foreign profile/typing rejection and host-only clock updates.

The eight new ordinary browser scenarios cover paused saved-position creation,
host resume, return-home history, avatar preference, draft-free typing and
fullscreen notices across desktop/mobile Chromium and WebKit. These use controlled
Firebase/YouTube fixtures; they are not live-provider evidence. Browser plugin was
not available, so the project Playwright setup was used. Mobile library layout
and desktop/mobile fullscreen chat screenshots were visually inspected; no horizontal
overflow or browser page errors were found in the new journeys.

Review screenshots: [mobile library](qa/phase8-17/mobile-library.png),
[mobile fullscreen typing](qa/phase8-17/mobile-fullscreen-typing.png),
[desktop fullscreen typing](qa/phase8-17/desktop-fullscreen-typing.png).

## Bounded security review

- **Playback: no confirmed new finding.** Checked finite clock input, clamped
  targets, provider callback teardown, paused/buffering behavior and preservation
  of host-only authoritative writes. No new network endpoint or credentials.
- **Library: no confirmed new finding.** Checked hostile stored titles render as
  text, invalid/foreign-origin links and room invitations are rejected, unknown
  stored fields are dropped and storage denial does not expose raw errors.
  Persistence is deliberately local and explicitly described in the UI.
- **Participant features: no confirmed new finding.** Real rules tests deny
  foreign profiles, forged typing identities/connections, extra fields, future
  timestamps and outsider reads. Runtime checks prove no draft-text publication,
  idle expiry and own-connection cleanup. Avatar values cannot inject URLs/classes.

No discovered security issue was silently fixed. This bounded review is not a
whole-application penetration test. Physical device checks, real shared-Drive
movie playback, cross-network TURN/NAT, large-scale abuse and multi-hour/background
stability remain unverified by this task. Live YouTube and the new production
rules were verified during the release below.

## Release and preservation

The user approved deployment on 2026-10-26. Firebase database job
`1792957574547` completed successfully before the frontend release. Authenticated
readback matches the tested local rules exactly. Preflight comparison verified
that existing deployed rules matched after excluding only the additive profiles
and typing branches; unrelated policies were preserved. The connector's rule
read/validation endpoints returned Invalid URL, so readback used the existing
authenticated CLI client and the real emulator suite provided validation.

Release qualification strengthened YouTube startup coverage: a pre-ready state
event and a PAUSED event before initial clock alignment could replace a saved
position with zero. A new adapter unit test and browser regression first failed;
the adapter now ignores pre-ready events and the app ignores startup state
publication until initial alignment. All 222 unit/integration tests and all
126 browser checks then passed. Test-observer readiness, navigation timing and
progress-acknowledgement mistakes were corrected separately in private QA code;
failed attempts are not counted as passes.

Netlify candidate `6adee5bf54010e82fefe04b5` passed all 13 live checks before the
same isolated artifact was published as production deploy
`6adee6f67393f989dabd2c1b` at [Watch Party](https://partyapp-fun.netlify.app).
Netlify's published-deploy pointer was checked. All 13 artifact files match on
the live site; only its known non-executable Netlify hosting comment is removed
before comparing the production HTML hash. JavaScript, CSS, fonts and other
assets match byte-for-byte. Normalized HTML SHA-256:
`0f3c3e75cd78ffd3e1a1395ec8945c21adda67449e1fcdd3182cf50f0f41c616`.

Both candidate and production checks use fresh real Firebase anonymous accounts,
private QA rooms, native browser RTC and the actual YouTube IFrame API with its
[official reference video](https://developers.google.com/youtube/iframe_api_reference).
They prove wishlist reload persistence, avatar delivery, timestamp-only typing,
fullscreen typing/messages/replies, cross-identity write denial and anonymous
read rejection, real playback/seek/pause progress saving, new-room bookmark
restoration, host Resume, history/wishlist clearing and avatar reload persistence.
Existing voice exchanges native RTP and recovers with mute preserved; screen
sharing decodes native video frames and clears ownership on Stop. Microphones
are synthetic and screen capture uses an owned canvas: transport is verified,
not acoustic quality or a physical OS picker. The mobile client is browser
emulation. No browser page errors occurred in either completed journey.

No proxy, Android build, commit or push was performed. Older web clients and the
Android companion ignore the additive fields. Existing web clients should reload
to receive this release.

Private emulator evidence stays outside the repository because Firebase CLI
logs can include environment details. All 11 recorded disposable production QA
rooms/grant collections and 13 fresh QA accounts were deleted after verification.
One early observer failure required recovering its owned room using name/time
leaves and matching fresh anonymous identity metadata; no unrelated room was
modified. Owned emulator and Vite servers are stopped by their test runners.
Protected proxy hashes matched and both Git indexes remained empty. Scoped
whitespace checks passed. No unrelated dependency/configuration change was made.
