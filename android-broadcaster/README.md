# Watch Party Broadcast for Android

Native Android screen-video broadcaster for the existing Watch Party web rooms.
Android 11+ on supported WebRTC devices. The current build supports **screen video
only**; device playback audio and native voice chat are not implemented.

1. In the web room, choose **Copy invite**.
2. Open **Watch Party Broadcast** and paste that full private link.
3. Enter a broadcaster name different from your browser participant name. The
   native app occupies one of the room's six identity seats.
4. Tap **Start sharing**, then approve Android's screen-capture dialog.
5. Open the screen/app to share. The broadcaster's own controls are protected
   from capture so the invitation is not transmitted.
6. Use **Stop sharing** in the app or its persistent notification to end capture.

No recording is saved. Android or protected apps may stop/block capture. Capture
is not restarted silently after a network loss, OS stop or process restart; a new
session requires fresh Android consent. Firebase authentication and private room
rules remain authoritative. A valid reusable invitation is not a permanent-ban
mechanism. Cross-network connectivity currently depends on direct/STUN routes;
TURN is not configured by this app.

## Build

Install JDK 21 and Android SDK Platform/Build Tools 35. Set `JAVA_HOME` and
`ANDROID_HOME`. Download the SDK configuration for registered Android package
`com.watchparty.broadcast` in Firebase project `watch-party-app-9fc62`; keep it
outside the repository. Gradle verifies that project/package before using it.

```powershell
.\gradlew.bat "-PfirebaseConfig=C:\private\google-services.json" :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. This is a debug-signed
development artifact, not a Play Store release. The Firebase client configuration
identifies the public app; it does not grant administrative access. Server keys,
service-account credentials and privileged tokens must never be included.

## Tests

Unit tests cover private invite parsing, invalid input, screen signal/session
matching and cold-cache cleanup ownership. Instrumented `RoomClientIntegrationTest` uses the actual native Firebase
SDK and deployed rule source against local Auth/RTDB emulators. On a connected
physical phone, reverse ports 9000 and 9099, start emulators with
`../firebase.emulators.json`, and run:

```powershell
.\gradlew.bat "-PfirebaseConfig=C:\private\google-services.json" "-Pandroid.testInstrumentationRunnerArguments.class=com.watchparty.broadcast.RoomClientIntegrationTest,com.watchparty.broadcast.NotificationRouteTest" :app:connectedDebugAndroidTest
```

The debug variant permits cleartext **only** to loopback for emulator tests. The
release manifest forbids cleartext. No emulator host or admin token exists in
the main app sources. The debug-only capture pattern activity provides a safe
owned screen for real MediaProjection testing without filming private apps.

`NativeCaptureJourneyTest` is opt-in: pass a disposable production invitation
through the instrumentation `invite` argument while a controlled browser viewer
is in that room. It exercises Android consent cancellation, actual capture,
browser connection, a 60-second soak and explicit Stop. Without that argument it
is skipped. Clean up the disposable room and grant afterward; preserve the native
app's anonymous account if leaving the app installed for reuse.

From the frontend directory, `node android-broadcaster/qa/native-browser.cjs`
coordinates this opt-in journey with the installed app/test APK. It creates a
disposable live room, verifies decoded owned-pattern pixels, reconnects the
viewer and requires server-confirmed share removal after Stop. Set `ADB_PATH`
when adb is outside PATH and `WATCH_PARTY_QA_OUT` to a private evidence folder.
The resulting room/account selectors must be cleaned up after the test; keep
`preserveAuthUids` and never publish the private runtime logs or invitation.

Check [the QA report](../docs/ANDROID_BROADCAST_QA.md) for current results; source/build completion is not proof of
physical capture, live Firebase or iPhone support. This module does not implement
an iOS app or make Android Chrome's missing screen-capture API available.
