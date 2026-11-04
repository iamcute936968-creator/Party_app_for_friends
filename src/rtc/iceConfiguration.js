const DIRECT = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }, { urls: ['stun:stun.cloudflare.com:3478'] }] };
const ICE_URL = /^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478\?transport=(?:udp|tcp)|443\?transport=udp|80\?transport=tcp)|turns:turn\.cloudflare\.com:(?:5349|443)\?transport=tcp)$/;
const METERED_ICE_URL = /^(?:stun:stun\.relay\.metered\.ca:80|turn:(?:global|standard)\.relay\.metered\.ca:(?:80|443|3478)(?:\?transport=(?:udp|tcp))?|turns:(?:global|standard)\.relay\.metered\.ca:443(?:\?transport=tcp)?)$/;
const boundedString = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[^\x21-\x7e]/.test(value);
const authorizationError = () => Object.assign(new Error('Room authorization is required.'), { code: 'RTC_AUTH_REQUIRED' });
const copy = configuration => ({ iceServers: configuration.iceServers.map(server => ({ ...server, urls: [...server.urls] })) });

function endpoint(proxyUrl) {
  try {
    const url = new URL(proxyUrl);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return null;
    return `${url.href.replace(/\/+$/, '')}/api/rtc/ice`;
  } catch { return null; }
}

function relayConfiguration(data, now) {
  if (!Number.isFinite(data?.expiresAt) || data.expiresAt <= now || !Array.isArray(data.iceServers) ||
    !data.iceServers.length || data.iceServers.length > 16) throw new Error('Invalid relay response');
  let hasTurn = false;
  const iceServers = data.iceServers.map(server => {
    const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 16 ||
      urls.some(url => typeof url !== 'string' || url.length > 160 || (!ICE_URL.test(url) && !METERED_ICE_URL.test(url)) || /\s/.test(url))) throw new Error('Invalid relay response');
    if (urls.some(url => url.startsWith('turn'))) {
      hasTurn = true;
      if (!boundedString(server.username) || !boundedString(server.credential)) throw new Error('Invalid relay response');
      return { urls: [...urls], username: server.username, credential: server.credential };
    }
    return { urls: [...urls] };
  });
  if (!hasTurn) throw new Error('Invalid relay response');
  return { iceServers };
}

export function createIceConfiguration({ proxyUrl, getAuthorization, fetchFn = globalThis.fetch, now = Date.now, onStatus = () => {} }) {
  const url = endpoint(proxyUrl);
  let scope;
  let epoch = 0;
  let calls = 0;
  let latestAuthorization = 0;
  let cached;
  let pending;
  return async () => {
    if (!url) { onStatus('direct'); return copy(DIRECT); }
    const call = ++calls;
    let authorization;
    try { authorization = await getAuthorization(); } catch { throw authorizationError(); }
    if (!authorization || !['roomId', 'roomSecret', 'username', 'firebaseIdToken', 'uid']
      .every(key => typeof authorization[key] === 'string' && authorization[key].length > 0 && authorization[key].length <= 16384)) throw authorizationError();
    const { roomId, roomSecret, username, firebaseIdToken, uid } = authorization;
    const requestScope = JSON.stringify([roomId, uid, username]);
    if (call > latestAuthorization) {
      latestAuthorization = call;
      if (scope !== requestScope) { scope = requestScope; epoch++; cached = null; pending = null; }
    }
    const requestEpoch = epoch;
    const active = () => scope === requestScope && epoch === requestEpoch;
    const publish = result => { if (active()) onStatus(result.status); return copy(result.configuration); };
    if (active() && cached?.until > now()) return publish(cached);
    if (active() && pending) return publish(await pending);
    const request = (async () => {
      const controller = new AbortController();
      let timer;
      try {
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Relay timeout')); }, 5000); });
        return await Promise.race([deadline, (async () => {
          const response = await fetchFn(url, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, roomSecret, username, firebaseIdToken }), signal: controller.signal });
          if (response.status === 401 || response.status === 403) throw authorizationError();
          if (!response.ok) throw new Error('Relay unavailable');
          const data = await response.json();
          return { configuration: relayConfiguration(data, now()), status: 'relay', until: data.expiresAt - 3600000 };
        })()]);
      } catch (error) {
        if (error?.code === 'RTC_AUTH_REQUIRED') throw authorizationError();
        return { configuration: DIRECT, status: 'direct', until: now() + 30000 };
      } finally { clearTimeout(timer); }
    })();
    if (active()) pending = request;
    try {
      const result = await request;
      if (active()) cached = result;
      return publish(result);
    } finally { if (pending === request) pending = null; }
  };
}
