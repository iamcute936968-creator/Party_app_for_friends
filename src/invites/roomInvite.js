const validRoomId = (value) => typeof value === 'string' && /^[A-Z0-9_-]{1,64}$/i.test(value);

export function parseRoomInvite(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (validRoomId(input)) return { roomId: input.toUpperCase() };
  try {
    if (!/^https?:\/\//i.test(input) && !input.startsWith('?')) return null;
    const url = new URL(input.startsWith('?') ? `https://invite.invalid/${input}` : input);
    const roomId = url.searchParams.get('room');
    if (!validRoomId(roomId)) return null;
    return { roomId: roomId.toUpperCase(), secret: url.searchParams.get('s') || '' };
  } catch { return null; }
}

export function buildRoomInvite(base, roomId, secret) {
  if (!validRoomId(roomId)) return '';
  try {
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', roomId);
    if (typeof secret === 'string' && secret) url.searchParams.set('s', secret);
    return url.href;
  } catch { return ''; }
}
