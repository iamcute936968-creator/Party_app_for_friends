// Opt-in physical Android / production-browser journey. Uses only a newly created private QA room.
const { chromium, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const adb = process.env.ADB_PATH || 'adb';
const out = process.env.WATCH_PARTY_QA_OUT || path.join(os.tmpdir(), 'watch-party-native-capture-qa');
fs.mkdirSync(out, { recursive: true });
const report = { rooms: [], preserveAuthUids: [], checks: [], samples: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
const pass = (name) => { report.checks.push({ name, passed: true }); save(); console.log('PASS ' + name); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function sdkValue(page, roomId, suffix = '') {
  return page.evaluate(async ({ roomId, suffix }) => {
    const app = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
    const sdk = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');
    return (await sdk.get(sdk.ref(sdk.getDatabase(app.getApps()[0]), '/rooms/' + roomId + suffix))).val();
  }, { roomId, suffix });
}
async function video(page) {
  return page.evaluate(async () => {
    let frames = 0;
    for (const peer of window.qaPeers) if (peer.connectionState === 'connected') {
      for (const stat of (await peer.getStats()).values()) if (stat.type === 'inbound-rtp' && stat.kind === 'video') frames += stat.framesDecoded || 0;
    }
    const media = [...document.querySelectorAll('video')].find(video => video.srcObject && video.videoWidth);
    let redPixels = 0;
    if (media) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d'); context.drawImage(media, 0, 0, 64, 64);
      const data = context.getImageData(0, 0, 64, 64).data;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 160 && data[i + 1] < 130 && data[i + 2] < 130) redPixels++;
    }
    return { frames, redPixels, peerCount: window.qaPeers.length };
  });
}
(async () => {
  let browser, host, id, native, logger, runtimeLog, nativeDone = false, nativePassed = false;
  try {
    if (!/\tdevice\b/.test(execFileSync(adb, ['devices'], { encoding: 'utf8' }))) throw new Error('Connect and unlock the authorized Android phone first');
    browser = await chromium.launch();
    host = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    host.on('pageerror', error => report.errors.push(error.message.replace(/https?:\/\/[^\s]+/g, '[URL]').slice(0, 300)));
    await host.addInitScript(() => {
      window.qaPeers = []; const Native = RTCPeerConnection;
      window.RTCPeerConnection = function(options) { const peer = new Native(options); window.qaPeers.push(peer); return peer; };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.qaInvite = value; } } });
    });
    await host.goto('https://partyapp-fun.netlify.app');
    await host.getByLabel('Your name').fill('QAHost');
    await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(host.getByRole('heading', { level: 1 })).toHaveText("QAHost's Room");
    id = await host.locator('.room-identity p > span').first().textContent();
    const hostUid = await host.evaluate(async () => {
      const app = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
      const auth = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
      return auth.getAuth(app.getApps()[0]).currentUser.uid;
    });
    report.rooms.push({ id, hostUid, roomName: "QAHost's Room" }); save();
    await host.getByRole('button', { name: 'Copy invite', exact: true }).click();
    const invite = await host.evaluate(() => window.qaInvite);
    const parsed = new URL(invite);
    if (parsed.origin !== 'https://partyapp-fun.netlify.app' || !/^[A-Z0-9]+$/.test(parsed.searchParams.get('room')) || !/^[a-f0-9-]+$/.test(parsed.searchParams.get('s'))) throw new Error('Unexpected QA invite format');
    const uid = /package:com\.watchparty\.broadcast\s+uid:(\d+)/.exec(execFileSync(adb, ['shell', 'pm', 'list', 'packages', '-U', 'com.watchparty.broadcast'], { encoding: 'utf8' }))?.[1];
    if (!uid) throw new Error('Install the owned Android APK first');
    runtimeLog = fs.createWriteStream(path.join(out, 'native-runtime-private.log'));
    logger = spawn(adb, ['logcat', '--uid=' + uid, '-T', '1', '-v', 'brief']); logger.stdout.pipe(runtimeLog); logger.stderr.pipe(runtimeLog);
    const command = "am instrument -w -r -e invite '" + invite + "' -e class com.watchparty.broadcast.NativeCaptureJourneyTest com.watchparty.broadcast.test/androidx.test.runner.AndroidJUnitRunner";
    native = spawn(adb, ['shell', command]);
    let nativeOutput = '';
    native.stdout.on('data', chunk => { nativeOutput += chunk; });
    native.stderr.on('data', chunk => { nativeOutput += chunk; });
    const finished = new Promise(resolve => native.on('close', () => {
      nativeDone = true; nativePassed = /OK \(1 test\)/.test(nativeOutput);
      fs.writeFileSync(path.join(out, 'native-journey.log'), nativeOutput.replaceAll(invite, '[PRIVATE QA INVITE]')); resolve();
    }));
    const checkedVideo = async () => { if (nativeDone && !nativePassed) throw new Error('Native Android journey failed; inspect the private test log'); return video(host); };
    await expect.poll(async () => (await checkedVideo()).redPixels, { timeout: 60000 }).toBeGreaterThan(400);
    const room = await sdkValue(host, id);
    if (room.identities?.QAPhone) report.preserveAuthUids.push(room.identities.QAPhone); save();
    expect(room.screenShare.owner).toBe('QAPhone');
    pass('Physical Android MediaProjection streams the owned pattern into the production browser');
    const before = (await video(host)).peerCount;
    await host.getByRole('button', { name: 'Reconnect screen share', exact: true }).click();
    await expect.poll(async () => (await checkedVideo()).peerCount, { timeout: 30000 }).toBeGreaterThan(before);
    await expect.poll(async () => (await checkedVideo()).redPixels, { timeout: 30000 }).toBeGreaterThan(400);
    pass('Browser viewer reconnects to the native broadcaster');
    // Sample before the native journey intentionally stops at 60 seconds. The
    // instrumented test owns the full soak; frames must stop after explicit Stop.
    for (let i = 0; i < 5; i++) {
      await delay(5000);
      if (nativeOutput.includes('watch_party_stage=opening_stop_controls')) break;
      const sample = await checkedVideo(); expect(sample.frames).toBeGreaterThan(0); expect(sample.redPixels).toBeGreaterThan(400); report.samples.push(sample); save();
    }
    expect(report.samples.length).toBeGreaterThan(0);
    await host.screenshot({ path: path.join(out, 'android-native-screen-viewer.png') });
    await Promise.race([finished, delay(40000).then(() => { throw new Error('Native capture stop did not complete'); })]);
    expect(nativePassed).toBe(true);
    pass('Android consent cancellation, 60-second native capture and explicit Stop pass');
    await expect(host.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled({ timeout: 15000 });
    expect((await sdkValue(host, id, '/screenShare'))).toBeNull();
    pass('Native Stop releases the broadcast and restores desktop sharing');
    expect(report.errors).toEqual([]);
  } catch (error) {
    if (host && id) {
      try {
        const current = await sdkValue(host, id);
        if (current?.identities?.QAPhone && !report.preserveAuthUids.includes(current.identities.QAPhone)) report.preserveAuthUids.push(current.identities.QAPhone);
        report.nativeDiagnostics = { enrolled: Boolean(current?.identities?.QAPhone), hasBroadcast: Boolean(current?.screenShare), owner: current?.screenShare?.owner || null };
      } catch { /* Preserve the original failure if the provider is unavailable. */ }
    }
    report.failure = String(error.message).replace(/https?:\/\/[^\s]+/g, '[URL]').slice(0, 800);
    console.log('FAIL ' + report.failure);
  } finally {
    if (native && (!nativeDone || report.failure)) {
      if (!nativeDone) native.kill();
      try { execFileSync(adb, ['shell', 'am', 'force-stop', 'com.watchparty.broadcast'], { stdio: 'ignore' }); } catch { /* Device may have been unplugged. */ }
    }
    logger?.kill(); runtimeLog?.end();
    await browser?.close(); save();
    console.log(JSON.stringify({ passed: report.checks.length, failure: report.failure, results: path.join(out, 'results.json') }));
    process.exitCode = report.failure ? 1 : 0;
  }
})();
