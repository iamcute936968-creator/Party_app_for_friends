export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_EDIT_WINDOW = 180000;
export function canEditMessage(message, uid, now = Date.now()) {
  return Boolean(uid && message?.uid === uid && message.type === 'user' && !message.audio && Number.isFinite(message.createdAt) && message.createdAt > 0 && now >= message.createdAt && now - message.createdAt <= CHAT_EDIT_WINDOW);
}

// Bound the conversation retained by the UI; Firebase's room snapshot is unchanged.
export function getRecentMessages(rawMessages) {
  const timestamp = (message) => Number.isFinite(message.createdAt) ? message.createdAt : Number.isFinite(message.timestamp) ? message.timestamp : 0;
  return Object.entries(rawMessages || {})
    .filter(([, message]) => message && typeof message === 'object' && typeof message.text === 'string')
    .map(([id, message]) => ({ ...message, id, user: typeof message.user === 'string' ? message.user : '' }))
    .sort((a, b) => timestamp(a) - timestamp(b) || a.id.localeCompare(b.id))
    .slice(-CHAT_HISTORY_LIMIT);
}
