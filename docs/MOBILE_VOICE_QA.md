# Mobile voice, screen viewing and fullscreen chat QA

Date: 2026-10-25. Scope: persistent voice opt-in/recovery, microphone diagnostics,
Android screen-share viewing and in-stage messaging. This is a bounded functional
and security review, not an exhaustive application penetration test.

## Changes

- Joining voice retains the user's opt-in and mute state during signaling loss.
  Recovery renews the voice session automatically without recapturing the mic.
  Transient peer disconnects get an eight-second grace period; failed peers retry
  with capped backoff. Explicit Leave and room teardown stop capture immediately.
- Browser-ended microphone tracks require an explicit Resume gesture. Permission
  denial does not publish voice presence. Echo cancellation, noise suppression,
  automatic gain control and mono capture are requested when supported.
- A mic input meter, connected-peer count and measured RTT/network feedback make
  capture and transport state visible. These measurements do not certify sound
  quality or guarantee background operation under Android power restrictions.
- New chat messages appear over the video for six seconds with an unread count.
  The in-stage conversation supports sending, retained drafts and retry without
  leaving the video. Existing history is not replayed as new notifications.
- The application owns fullscreen controls, including YouTube's viewing stage.
  On Android keyboard resize it falls back from native fullscreen to an immersive
  stage sized to the visual viewport, keeping the composer above the keyboard.
- Browsers without `getDisplayMedia` show desktop-broadcast guidance rather than
  an unsupported Share action. Android remains a viewer, as the user requested.

## TDD and local regression evidence

Tests were written and observed failing before the behavioral fixes. The real
phone exposed a further keyboard sizing failure: the composer bottom was at
640px while the visible viewport was 344px. A failing fullscreen-hook regression
was added before fixing that transition; the phone retest placed the composer
at 321px within the same 344px viewport.

| Command/check | Result |
| --- | --- |
| `npm run test:unit` | 139 passed |
| `npm run test:integration` | 61 passed |
| Firebase emulators: `node --test --test-force-exit tests/rules/database.test.mjs` | 19 passed |
| Firebase emulators: Playwright `playwright.rtc.config.js` | 1 native RTC journey passed |
| `npm run test:e2e` | 114 passed, 2 existing Windows WebKit H.264 skips |
| Playwright Drive retry suite with `VITE_DRIVE_STREAMING=false` | 28 passed |
| `media-proxy`: `npm test` | 46 passed: 6 unit, 2 new integration, 38 existing checks |
| Production build, scoped ESLint, whitespace checks | Passed |
| Whole-project `npm run lint` | Existing 24 errors and 5 warnings remain |

Total local functional/regression checks: **408 passed**, plus two codec skips.
Browser profiles cover desktop/mobile Chromium and desktop/mobile WebKit. These
isolated browser tests do not constitute physical iOS proof.

## Physical Android evidence

Device: CPH2455, Android 14 / SDK 34, Chrome 155.0.8059.85. USB debugging was
authorized and the user unlocked the phone and allowed microphone access.

Eight checks passed against the local Vite frontend through USB reverse with
the actual Firebase SDK, anonymous authentication and deployed database rules:

1. Private room entry and Android viewing guidance.
2. Native WebRTC desktop-to-phone video frames decoded on the phone.
3. Incoming chat popup over fullscreen video.
4. Phone reply sent while the actual software keyboard was open; stage retained.
5. Physical phone microphone and desktop exchanged audio RTP.
6. Deliberate Firebase signaling offline/online recovered automatically with one
   microphone capture and mute preserved.
7. Six samples over 60 seconds remained connected to the desktop. Audio bytes
   and decoded video frames increased; observed RTT was approximately 5–9ms.
8. Explicit Leave ended the phone's microphone track.

The desktop microphone was synthetic and screen source was an animated canvas.
No recording was saved. RTP proves transport, not subjective acoustic quality.
The short soak does not prove hours-long stability, screen-lock survival or
cross-network NAT traversal. Android broadcast and physical iOS were not tested.

## Security review: approved finding fixed

- **Medium: access revocation leaves established voice media running.** Affected:
  `src/hooks/useVoiceChat.js` signal-subscription error callback and peer lifecycle;
  `src/App.jsx` room subscription; room-access/voice revocation contract. In a
  disposable private room, two authorized clients first established voice. An
  administrator then deleted only the guest's own `/roomAccess/{room}/{uid}`
  grant. Firebase rejected subsequent subscriptions, but the guest mic remained
  `live` and received audio increased from 3,831 to 19,567 bytes over five seconds.
  The UI still reported one connected person. A previously admitted member could
  continue an already established conversation after access removal. The same
  generic subscription-error behavior exists in the pre-change baseline.
  The user approved remediation after this finding was reported. The hook now
  validates its own private grant and stops on revocation or permission denial.
  Each remote peer requires confirmed authorization from a narrowly readable
  `/roomAccess/{room}/{uid}/name` leaf. Its conditional Firebase rule requires
  valid grants and UID bindings for reader and target. Deletion, name mismatch
  or secret changes cancel that admission and close the honest peer's native
  connection, independently of the revoked endpoint. Cross-UID grant-object and
  secret reads remain denied. Late callbacks cannot restore a replaced session.
  No user room was modified by these probes.

  Unit and multi-client integration regressions first reproduced the failure.
  Real emulator listeners prove cancellation for deletion and a secret mutation
  outside the watched name. The native RTC journey freezes the revoked client's
  callbacks and verifies the honest host closes for both mutations. Independent
  boundary investigation and candidate review found no further concrete bypass
  in this invariant. Two live checks passed first against the local frontend and
  then again against the deployed frontend/rules: revoked capture ended and the
  other endpoint closed while its own microphone remained opted in.

  Valid reusable invitations still permit room enrollment; deleting a grant does
  not establish a permanent ban. Existing clients must reload to run the fix.

Other bounded checks passed: no capture before Join, denied/late capture cleanup,
mute/Leave behavior, own-session transaction guards, other-tab protection,
unjoined/stale-session signal rejection, bounded ICE queues, authenticated chat
authors and hostile chat text rendered as text. No further confirmed issue was
identified in those checks. This does not establish complete security.

## Evidence and remaining limits

Machine-readable checks and screenshots are retained outside the repository in
`~/.codex/tmp/watch-party-mobile-regression/` and
`~/.codex/tmp/watch-party-mobile-qa/`. Raw Firebase CLI logs are private because
the CLI can include environment details; do not publish them.

All **14** disposable rooms/grants and **21** fresh QA accounts from the initial
attempts, candidates, production checks and security probes were removed.
Existing phone identities were preserved. Protected proxy files and pre-existing
workspace changes were preserved. No commit or push was made.

Real shared-Drive movie playback, a physical desktop OS screen-picker capture,
subjective audio/echo quality, multi-hour and background stability, physical iOS,
and cross-network TURN/NAT remain unverified. The current voice configuration
uses STUN and has no TURN relay configured.

## Release verification

Firebase database deployment job `1792935910360` completed successfully. Netlify
candidate `6ade07f20c57a222b6504116` passed seven live checks with real Firebase,
native audio/video RTP, fullscreen chat, automatic reconnect, mute preservation
and capture cleanup. Its tested assets were published as production deployment
`6ade087dac898286a60ea518` at <https://partyapp-fun.netlify.app>.

The first candidate exposed a notification clock-skew bug. A failing unit test
was added before changing notifications to use new message IDs and preloading
room history before rendering. The final candidate received the immediate
post-join popup and reply successfully. Failed checks were not counted as passes.

The same eight physical-phone checks then passed against the production site,
including another 60-second connected soak and explicit microphone cleanup.
This final run used the released authorization checks and Firebase rule. USB
debug forwards/reverse and the owned Vite server were removed/stopped afterward;
the phone's stay-awake setting remains unchanged.

The user's subsequent clarification is that the intended product must also
broadcast from phones. This release verifies Android viewing; it does not add
native Android/iOS capture. The desktop capture implementation remains in place.
Future mobile broadcasting must be selected and device-tested separately.
