import { expect, test } from '@playwright/test';

test('authenticated clients exchange chat, reactions, voice and screen video and recover after abrupt owner exit', async ({ browser }, info) => {
  test.setTimeout(120000);
  const contexts = [], errors = [];
  const makePage = async (avatar = 'slate') => {
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 900 } }); contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url()); let body;
      if (url.origin === 'http://127.0.0.1:5175' && url.pathname === '/src/firebaseClient.js') body = "export {database,ensureFirebaseUser,firebaseAuth,accountSdk} from '/tests/rtc/firebase-emulator-client.js';";
      else if (['http://127.0.0.1:5175','http://127.0.0.1:9000','http://127.0.0.1:9099'].includes(url.origin)) return route.continue();
      else if (url.pathname.endsWith('/firebase-database.js')) body = "export * from 'http://127.0.0.1:5175/tests/rtc/firebase-emulator-client.js';";
      else if (url.hostname === 'www.youtube.com') body = 'window.YT={Player:function(){}};window.onYouTubeIframeAPIReady?.();';
      else if (url.hostname === 'accounts.google.com') body = 'window.google={accounts:{oauth2:{}}};';
      else throw new Error('Unexpected non-local RTC test request: '+url.origin);
      return route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body });
    });
    await page.addInitScript(({ avatar }) => {
      localStorage.setItem('watchparty.participant-profile.v1', JSON.stringify({ avatar }));
      window.testPeers = []; window.testMicStreams = [];
      const NativePeer = window.RTCPeerConnection;
      // Real native peers and ICE; local host candidates avoid external STUN traffic.
      window.RTCPeerConnection = function(config) { const peer = new NativePeer({ ...config, iceServers: [] }); window.testPeers.push(peer); return peer; };
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (options) => { const stream = await capture(options); window.testMicStreams.push(stream); return stream; };
      window.testScreenStreams = [];
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const ctx = canvas.getContext('2d');
        const paint = () => { ctx.fillStyle = Date.now() % 2 ? '#e54b35' : '#20242a'; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = 'white'; ctx.fillText(String(Date.now()), 20, 40); };
        paint(); const timer = setInterval(paint, 80); const stream = canvas.captureStream(12);
        stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
        window.testScreenStreams.push(stream); return stream;
      };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value) => { window.testInvite = value; } }, configurable: true });
    }, { avatar });
    return page;
  };
  try {
    const host = await makePage(); await host.goto('/');
    await host.getByLabel('Your name').fill('Host');
    await host.getByRole('button', { name: 'Create Room', exact: true }).click();
    await expect(host.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
    const roomId = await host.locator('.room-identity p > span').first().textContent();
    const anonymous = await host.request.get(`http://127.0.0.1:9000/rooms/${roomId}.json?ns=demo-watch-party-default-rtdb`);
    expect(anonymous.status()).toBe(401);
    await host.getByRole('button', { name: 'Copy invite', exact: true }).click();
    const invite = await host.evaluate(() => window.testInvite);
    const guest = await makePage('coral'); await guest.goto(invite);
    await guest.getByLabel('Your name').fill('Guest');
    await guest.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
    await host.getByRole('button', { name: 'People (2)', exact: true }).click();
    await expect(host.locator('.participants-panel li').filter({ hasText: 'Guest' }).locator('.participant-initial')).toHaveClass(/avatar-coral/);
    await expect(host.getByRole('dialog', { name: 'Room people' }).getByLabel('Your avatar colour')).toHaveCount(0);
    await host.getByRole('button', { name: 'Close people' }).click();
    for (const page of [host, guest]) await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await guest.getByPlaceholder('Send a message…').fill('Native Firebase QA message');
    await expect(host.getByText('Guest is typing…')).toBeVisible();
    const typing = await guest.evaluate(async id => {
      const sdk = await import('/tests/rtc/firebase-emulator-client.js');
      return (await sdk.get(sdk.ref(sdk.database, `rooms/${id}/typing/Guest`))).val();
    }, roomId);
    expect(Object.values(typing)).toHaveLength(1);
    expect(Object.keys(Object.values(typing)[0])).toEqual(['updatedAt']);
    await guest.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(host.getByText('Guest is typing…')).toHaveCount(0);
    await expect(host.getByRole('log', { name: 'Recent messages' })).toContainText('Native Firebase QA message');
    await expect(guest.getByRole('button', { name: 'Edit message', exact: true })).toBeVisible({ timeout: 5000 });
    await guest.getByRole('button', { name: 'Edit message', exact: true }).click();
    await guest.getByLabel('Edit message text', { exact: true }).fill('Edited native Firebase QA message');
    await guest.getByRole('button', { name: 'Save edit', exact: true }).click();
    await expect(host.getByRole('log', { name: 'Recent messages' })).toContainText('Edited native Firebase QA message');
    await expect(host.locator('.chat-bubble').filter({ hasText: 'Edited native Firebase QA message' }).locator('.chat-bubble-heading > span')).toContainText('Edited');
    for (const page of [host, guest]) await page.getByRole('tab', { name: 'Watch', exact: true }).click();
    await guest.getByRole('button', { name: 'Reactions', exact: true }).click();
    await guest.getByRole('button', { name: 'React with Love', exact: true }).click();
    await expect(host.getByRole('log', { name: 'Live reactions' })).toContainText('Guest');
    expect(await guest.evaluate(async (id) => {
      const sdk = await import('/tests/rtc/firebase-emulator-client.js');
      const user = await sdk.ensureFirebaseUser();
      try { await sdk.update(sdk.ref(sdk.database, 'rooms/'+id), { hostUid: user.uid }); return false; }
      catch { return true; }
    }, roomId)).toBe(true);
    for (const page of [host, guest]) {
      await expect(page.getByRole('button', { name: 'Join voice', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => window.testMicStreams.length)).toBe(0);
      await page.getByRole('button', { name: 'Join voice', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
      await page.getByRole('tabpanel', { name: 'Watch', exact: true }).getByText('Voice options', { exact: true }).click();
    }
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(() => window.testPeers.some((peer) => peer.connectionState === 'connected')), { timeout: 15000 }).toBe(true);
      await expect.poll(() => page.evaluate(async () => {
        for (const peer of window.testPeers) for (const stat of (await peer.getStats()).values()) {
          if (stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio') && stat.bytesReceived > 0) return true;
        }
        return false;
      }), { timeout: 15000 }).toBe(true);
      const enable = page.getByRole('button', { name: 'Enable voice audio', exact: true });
      if (await enable.isVisible()) await enable.click();
    }
    await guest.getByRole('button', { name: 'Mute microphone', exact: true }).click();
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].enabled)).toBe(false);
    await host.getByRole('button', { name: 'People (2)', exact: true }).click();
    await expect(host.getByLabel('Guest microphone muted', { exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Close people' }).click();
    for (const page of [host, guest]) await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await guest.getByRole('button', { name: 'Record voice note', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
    // Native MediaRecorder must stop itself within the bounded 15-second recording window.
    await expect(guest.getByRole('button', { name: 'Send recording', exact: true })).toBeEnabled({ timeout: 22000 });
    expect(await guest.evaluate(() => window.testMicStreams.length)).toBe(1);
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].enabled)).toBe(false);
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].readyState)).toBe('live');
    await guest.getByRole('button', { name: 'Send recording', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Play voice message', exact: true })).toBeVisible();
    const voiceNote = await host.evaluate(async id => {
      const sdk = await import('/tests/rtc/firebase-emulator-client.js');
      const messages = (await sdk.get(sdk.ref(sdk.database, `rooms/${id}/messages`))).val();
      return Object.values(messages).find(message => message.audio)?.audio;
    }, roomId);
    expect(voiceNote.durationMs).toBeGreaterThan(0);
    expect(voiceNote.durationMs).toBeLessThanOrEqual(15000);
    expect(voiceNote.bytes).toBeGreaterThan(0);
    expect(voiceNote.bytes).toBeLessThanOrEqual(131072);
    await host.getByRole('button', { name: 'Play voice message', exact: true }).click();
    const receivedAudio = host.locator('audio[aria-label="Voice message from Guest"]');
    await expect(receivedAudio).toBeVisible();
    await receivedAudio.click({ position: { x: 20, y: 25 } });
    await expect.poll(() => receivedAudio.evaluate(audio => audio.currentTime), { timeout: 10000 }).toBeGreaterThan(0);
    expect(await receivedAudio.evaluate(audio => audio.duration)).toBeGreaterThan(0);
    await receivedAudio.evaluate(audio => audio.pause());
    for (const page of [host, guest]) await page.getByRole('tab', { name: 'Watch', exact: true }).click();
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].enabled)).toBe(false);
    await guest.evaluate(async () => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); sdk.goOffline(sdk.database); });
    await expect(guest.getByRole('status', { name: 'Voice chat status' })).toContainText('Reconnecting');
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].readyState)).toBe('live');
    await guest.evaluate(async () => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); sdk.goOnline(sdk.database); });
    await expect(guest.getByRole('status', { name: 'Voice chat status' })).toContainText('Microphone muted');
    for (const page of [host, guest]) await expect(page.getByRole('status', { name: 'Voice connection health' })).toContainText('Connected to 1 person', { timeout: 20000 });
    expect(await guest.evaluate(() => window.testMicStreams.length)).toBe(1);
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].enabled)).toBe(false);
    await host.screenshot({ path: info.outputPath('real-rtc-host.png'), fullPage: true });
    await guest.getByRole('button', { name: 'Leave voice', exact: true }).click();
    expect(await guest.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].readyState)).toBe('ended');
    expect(await host.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].readyState)).toBe('live');
    await guest.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
    await expect.poll(() => host.evaluate(async () => {
      for (const peer of window.testPeers) for (const stat of (await peer.getStats()).values()) {
        if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video') && stat.framesDecoded > 0) return true;
      }
      return false;
    }), { timeout: 15000 }).toBe(true);
    await host.screenshot({ path: info.outputPath('real-screen-viewer.png'), fullPage: true });
    const oldId = await host.evaluate(async (id) => { const sdk = await import('/tests/rtc/firebase-emulator-client.js'); return (await sdk.get(sdk.ref(sdk.database, 'rooms/'+id+'/screenShare/id'))).val(); }, roomId);
    await guest.context().close();
    await expect(host.getByRole('button', { name: 'Share screen', exact: true })).toBeEnabled({ timeout: 15000 });
    await host.getByRole('button', { name: 'Share screen', exact: true }).click();
    await expect(host.getByRole('button', { name: 'Stop sharing', exact: true })).toBeVisible();
    expect(await host.evaluate(async ({id, oldId}) => {
      const sdk = await import('/tests/rtc/firebase-emulator-client.js');
      await sdk.remove(sdk.ref(sdk.database, 'rooms/'+id+'/screenShare/connections/'+oldId));
      const share = (await sdk.get(sdk.ref(sdk.database, 'rooms/'+id+'/screenShare'))).val();
      return share.id !== oldId && share.connections[share.id] === true;
    }, { id: roomId, oldId })).toBe(true);
    await host.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    expect(await host.evaluate(() => window.testScreenStreams[0].getVideoTracks()[0].readyState)).toBe('ended');
    for (const [name, mutation] of [['Revoked1', 'delete'], ['Revoked2', 'secret']]) {
      const revoked = await makePage(); await revoked.goto(invite);
      await revoked.getByLabel('Your name').fill(name);
      await revoked.getByRole('button', { name: 'Join Room', exact: true }).click();
      await expect(revoked.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
      await revoked.getByRole('button', { name: 'Join voice', exact: true }).click();
      await revoked.getByRole('tabpanel', { name: 'Watch', exact: true }).getByText('Voice options', { exact: true }).click();
      try {
        for (const page of [host, revoked]) await expect(page.getByRole('status', { name: 'Voice connection health' })).toContainText('Connected to 1 person', { timeout: 15000 });
      } catch (error) {
        for (const [label, page] of [['host', host], [name, revoked]]) console.log('RTC_HEALTH ' + JSON.stringify(await page.evaluate(async ({ label, roomId }) => {
          const sdk = await import('/tests/rtc/firebase-emulator-client.js');
          const voice = (await sdk.get(sdk.ref(sdk.database, `rooms/${roomId}/voice`))).val() || {};
          return { label, health: document.querySelector('[aria-label="Voice connection health"]')?.textContent,
            active: Object.entries(voice).filter(([, value]) => Object.values(value.connections || {}).some(Boolean)).map(([name]) => name),
            peers: window.testPeers.map(peer => ({ state: peer.connectionState, local: peer.localDescription?.type, remote: peer.remoteDescription?.type })) };
        }, { label, roomId })));
        throw error;
      }
      await host.getByRole('button', { name: 'Share screen', exact: true }).click();
      await expect.poll(() => revoked.evaluate(async () => {
        for (const peer of window.testPeers) for (const stat of (await peer.getStats()).values())
          if (stat.type === 'inbound-rtp' && stat.kind === 'video' && stat.framesDecoded > 0) return true;
        return false;
      }), { timeout: 15000 }).toBe(true);
      const revokedUid = await revoked.evaluate(async () => (await (await import('/tests/rtc/firebase-emulator-client.js')).ensureFirebaseUser()).uid);
      await revoked.evaluate(() => { window.testIgnoreAuthorizationUpdates = true; });
      const target = `http://127.0.0.1:9000/roomAccess/${roomId}/${revokedUid}${mutation === 'secret' ? '/secret' : ''}.json?ns=demo-watch-party-default-rtdb`;
      const response = mutation === 'delete'
        ? await host.request.delete(target, { headers: { authorization: 'Bearer owner' } })
        : await host.request.put(target, { headers: { authorization: 'Bearer owner' }, data: JSON.stringify('revoked-secret') });
      expect(response.ok()).toBe(true);
      await expect.poll(() => host.evaluate(() => window.testPeers.every((peer) => peer.connectionState !== 'connected')), { timeout: 10000 }).toBe(true);
      const frames = () => revoked.evaluate(() => [...document.querySelectorAll('video')].reduce((total, video) => total + (video.getVideoPlaybackQuality?.().totalVideoFrames || 0), 0));
      await revoked.waitForTimeout(500);
      const afterClose = await frames();
      await revoked.waitForTimeout(2000);
      expect(await frames()).toBe(afterClose);
      expect(await host.evaluate(() => window.testScreenStreams.at(-1).getVideoTracks()[0].readyState)).toBe('live');
      await host.getByRole('button', { name: 'Stop sharing', exact: true }).click();
      expect(await host.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].readyState)).toBe('live');
      expect(await revoked.evaluate(() => window.testMicStreams[0].getAudioTracks()[0].readyState)).toBe('live');
      if (mutation === 'delete') {
        await revoked.goto(invite);
        await revoked.getByLabel('Your name').fill(name);
        await revoked.getByRole('button', { name: 'Join Room', exact: true }).click();
        await expect(revoked.getByRole('heading', { level: 1 })).toHaveText("Host's Room");
        expect(await revoked.evaluate(async () => (await (await import('/tests/rtc/firebase-emulator-client.js')).ensureFirebaseUser()).uid)).toBe(revokedUid);
        await host.getByRole('button', { name: 'Share screen', exact: true }).click();
        await expect.poll(() => revoked.evaluate(async () => {
          for (const peer of window.testPeers) for (const stat of (await peer.getStats()).values())
            if (stat.type === 'inbound-rtp' && stat.kind === 'video' && stat.framesDecoded > 0) return true;
          return false;
        }), { timeout: 15000 }).toBe(true);
        await host.getByRole('button', { name: 'Stop sharing', exact: true }).click();
      }
      await revoked.context().close();
      // The hostile page froze its auth callbacks. Remove only this scenario's
      // local fixture while its abrupt socket disconnect is still settling.
      const cleanup = await host.request.delete(`http://127.0.0.1:9000/rooms/${roomId}/voice/${name}.json?ns=demo-watch-party-default-rtdb`, { headers: { authorization: 'Bearer owner' } });
      expect(cleanup.ok()).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
