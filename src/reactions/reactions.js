export const REACTION_LIFETIME = 5000;
export const REACTION_LIMIT = 4;
export const REACTION_KINDS = ['like', 'love', 'applause', 'happy', 'sad', 'laugh', 'surprised'];

export function getLiveReactions(records, now) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
  return Object.entries(records)
    .filter(([, value]) => value && REACTION_KINDS.includes(value.kind) &&
      typeof value.user === 'string' && value.user.trim() && Number.isFinite(value.timestamp) &&
      value.timestamp > now - REACTION_LIFETIME && value.timestamp <= now + 1000)
    .map(([id, value]) => ({ id, kind: value.kind, user: value.user.trim().slice(0, 40), timestamp: value.timestamp }))
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    .slice(-REACTION_LIMIT);
}
