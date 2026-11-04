import { isParadiseId } from './paradise';
export function parseAnimeRoomSelection(value, origin = globalThis.location?.origin) {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      const url = new URL(value, origin), base = new URL(origin);
      const match = /^\/anime\/(ap_[A-Za-z0-9][A-Za-z0-9_-]{0,119})\/watch\/([1-9][0-9]{0,3})\/?$/.exec(url.pathname);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== base.origin || url.username || url.password || url.search || url.hash || !match) return null;
      candidate = { source: 'anime', id: match[1], episode: Number(match[2]) };
    } catch { return null; }
  }
  if (!candidate || candidate.source !== 'anime' || !isParadiseId(candidate.id) || !Number.isInteger(candidate.episode) || candidate.episode < 1 || candidate.episode > 9999) return null;
  return { source: 'anime', id: candidate.id, episode: candidate.episode, title: typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 120) : 'Anime', position: 0 };
}
export function animeRoomFields(selection) {
  const item = parseAnimeRoomSelection(selection);
  if (!item) throw new Error('Choose a valid anime episode.');
  return { videoSource: 'anime', videoId: item.id, animeEpisode: item.episode, animeTitle: item.title || 'Anime' };
}
export function animeRoomScope(room) {
  if (!room?.id || room.isSharing || !parseAnimeRoomSelection({ source: room.videoSource, id: room.videoId, episode: room.animeEpisode })) return null;
  return `${room.id}/anime/${room.videoId}/${room.animeEpisode}/${room.mediaSelectionId || ''}`;
}
