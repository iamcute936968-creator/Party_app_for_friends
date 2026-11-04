import { useCallback, useEffect, useRef, useState } from 'react';
import { animeRoomScope } from '../anime/room';
const empty = { scope: null, sourceUrl: '', subtitles: [], info: null, loading: false, error: '' };
export function useRoomAnimeStream({ room, api }) {
  const scope = animeRoomScope(room), id = room?.videoId, episode = room?.animeEpisode;
  const session = useRef(null), [resource, setResource] = useState(empty);
  const reload = useCallback(async () => {
    const current = session.current;
    if (!scope || current?.scope !== scope || !current.active) return false;
    current.controller?.abort();
    const controller = new AbortController(); current.controller = controller;
    setResource({ ...empty, scope, loading: true });
    const isCurrent = () => current.active && current === session.current && current.controller === controller && !controller.signal.aborted;
    try {
      const [info, stream] = await Promise.all([api.details(id, { signal: controller.signal }), api.stream(id, episode, { signal: controller.signal })]);
      if (!isCurrent()) return false;
      setResource({ scope, sourceUrl: stream.sourceUrl, subtitles: stream.subtitles, info, loading: false, error: '' }); return true;
    } catch {
      if (isCurrent()) setResource({ ...empty, scope, error: 'Could not prepare this anime episode. Please retry playback.' });
      return false;
    }
  }, [api, scope, id, episode]);
  useEffect(() => {
    const current = { scope, active: true, controller: null }; session.current = current;
    if (scope) void reload();
    return () => { current.active = false; current.controller?.abort(); };
  }, [scope, reload]);
  return { ...(scope && resource.scope === scope ? resource : { ...empty, loading: Boolean(scope) }), reload };
}
