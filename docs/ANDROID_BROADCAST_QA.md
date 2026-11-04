# Android screen broadcast QA

Started 2026-10-25; completed 2026-10-26. Scope: a native Android companion that sends screen video to
the existing Watch Party web room. This is a development APK, not a store release.
It does not add phone screen capture to Android Chrome or implement an iOS app.

## Delivered behavior

- Android 11+ build target; physical testing on CPH2455 / Android 14.
- Full private room invitation and a separate broadcaster name join through
  native anonymous Firebase Auth and the existing UID-bound room admission rules.
  The companion consumes one of six room seats.
- Each start requires Android MediaProjection consent. A foreground notification
  opens the controls and provides Stop. The app does not silently resume capture.
- Native WebRTC screen video works with the existing browser signaling protocol,
  including viewer reconnect, bounded retry, session filtering and admission checks.
- Capture controls hide the invitation from screenshots/capture and disable field
  autofill/state saving. No recording is saved. No microphone or camera permission.
- Screen video only. Device playback audio and native voice are not implemented;
  continue voice chat in the web room. Protected/DRM apps may block their content.

## Fixes and TDD evidence

Failing tests preceded native invite/protocol behavior and the Firebase adapter.
Further regressions reproduced numeric Firebase keys arriving as arrays, late
signals during retry, notification control navigation, and Stop with a cold
transaction cache. Native tests use the actual Android Firebase SDK.

The physical test found that capture ended while the broadcast marker remained.
A new emulator integration test reproduced `close()` failing without an active
room listener. Cleanup now permits Firebase's initial null transaction value to
retry against authoritative data, then checks both owner UID and share session.
Wrong-owner and wrong-session cleanup remain rejected. This follows the documented
[Firebase Android transaction behavior](https://firebase.google.com/docs/database/android/read-and-write#save_data_as_transactions).

Earlier physical attempts failed due to permission-dialog test selectors, control
navigation, or the cleanup regression. They are not counted as successful journeys.
The final journey waits for room cleanup before instrumentation exits; terminating
instrumentation kills the target app and would otherwise interrupt pending writes.

## Verification

| Command / check | Result |
| --- | --- |
| Gradle `:app:testDebugUnitTest` | 6 local unit tests passed |
| Gradle `:app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug` | Built; lint 0 errors, 1 warning |
| Auth/RTDB emulators with `RoomClientIntegrationTest` on the actual phone | 4 integration tests passed |
| `NotificationRouteTest` on the phone | 1 instrumented intent-contract test passed |
| `npm run test:unit` | 139 passed |
| `npm run test:integration` | 61 passed |
| Playwright `tests/e2e/screen-sharing.spec.js` | 12 passed across desktop/mobile Chromium and WebKit profiles |
| Physical production journey | 1 native journey and all 4 coordinated browser check groups passed |
| APK signature / permission / fixture checks | v2 signature valid; no camera, mic or emulator admin fixtures in main APK |
| Protected proxy hashes, Git indexes, whitespace | Checked; pre-existing work preserved; no commit or push |

The web tests above ran for this task. The larger previous application-wide
verification remains recorded in [Mobile voice QA](MOBILE_VOICE_QA.md); its older
408 checks were not all rerun for this separate native module.

The final production journey on CPH2455 used actual Android MediaProjection and
native WebRTC, not a synthetic capture track. The controlled browser decoded the
owned red test pattern; five samples rose from 56 to 243 decoded frames, each
with 1,102 red pixels in the sampled canvas. Viewer reconnect passed, Android
consent cancellation started no broadcast, and capture stayed active for 60
seconds. Notification control navigation and explicit Stop passed. Server share
removal and restored desktop Share action were confirmed; no browser page errors.
ADB confirmed no active MediaProjection afterward. This proves this device and
network path, not all Android versions or Internet routes.

Build commands run from `android-broadcaster` with an external `firebaseConfig`
file and process-local JDK/SDK paths. Native integration runs use
`firebase emulators:exec --only database,auth --project demo-watch-party --config
firebase.emulators.json`, ADB reverse ports 9000/9099 and instrumentation classes
`RoomClientIntegrationTest,NotificationRouteTest`. The opt-in live coordinator is
`node android-broadcaster/qa/native-browser.cjs` from the frontend directory.
See the [module README](../android-broadcaster/README.md) for repeatable setup.

## Bounded security review

- **No confirmed new vulnerability identified** in the reviewed native admission,
  ownership, signal filtering, capture-consent and exported-component boundaries.
  Unit tests reject unsafe invitations, stale sessions/connections and foreign
  cleanup; real SDK/rules tests reject invalid invitations and competing shares.
- **Runtime isolation:** an external ADB attempt to start the capture service is
  rejected as non-exported. Capture requires Android consent; cancellation does
  not start it. Own notification intents are immutable, state broadcasts are
  package-scoped and the receiver is not exported. Main controls use FLAG_SECURE.
- **Artifact review:** no camera/microphone permission or emulator admin fixture in
  the main APK; SDK config remains outside source control. Release cleartext is
  disabled; debug cleartext is restricted to emulator loopback. Backup is disabled
  and Android 12+ transfer exclusions are explicit.
- **Unverified:** native peer/own-grant revocation under hostile runtime conditions,
  older Android/OEM backup behavior, dependency binaries, prolonged/background
  operation and cross-network NAT traversal. Lint recommends an explicit legacy
  `fullBackupContent` policy for API 30 despite `allowBackup=false`; no credential
  extraction was demonstrated. This is a coverage limit, not a proven leak.

No newly discovered security issue was silently remediated. This bounded review
does not establish that the application is completely secure.

## Remaining limits

No TURN relay is configured, so restrictive networks may fail to connect. Other
Android versions, rotation/app-only capture variants, device playback audio,
physical iPhone broadcasting and long-duration/background behavior need separate
work and tests. A reusable room invite is not a permanent revocation/ban mechanism.
Existing web deployment and Firebase policy were not changed for this module.

The debug APK is `android-broadcaster/releases/WatchParty-Broadcast-0.1.0-debug.apk`.
Its receipt records the final SHA-256. Debug signing and the owned capture-pattern
activity are for development; a public release needs release signing and removal
of debug-only testing surfaces.

Final APK: 60,242,296 bytes; SHA-256
`060593c133b1644f9b02f00c734b53aa93a430bc43758320fa4b2c0383ea3481`.
The installed main APK hash matches this artifact.

## Cleanup

Removed all nine recorded owned QA rooms and grant collections plus nine fresh
QA host accounts. The native anonymous account was explicitly preserved. The
main app remains installed; the instrumentation APK was uninstalled. Capture
and the owned test screen were stopped, and ADB reverse ports 9000/9099 removed.
No device security settings were disabled. Protected proxy hashes matched and
both Git indexes remained empty; no commit, push or web/rules deployment.
