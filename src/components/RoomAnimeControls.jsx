import { getDubContext, getDubEpisodes, getDubSelection, getDubProvider } from '../anime/audioSources';
import EpisodeNavigator from './EpisodeNavigator';
export default function RoomAnimeControls({ source, videoId, room, media = {}, isHost, disabled, load, videoRef }) {
  const dub = source === 'youtube' ? getDubContext(videoId) : null;
  if (source !== 'anime' && !dub) return null;
  const animeId = dub?.animeId || videoId, episode = dub?.episode || room?.animeEpisode, title = dub?.title || room?.animeTitle || 'Anime';
  const dubChoice = getDubSelection(animeId, episode, title), blocked = !isHost || disabled || media.loading;
  const select = item => { if (!blocked) load?.(item); };
  const episodes = dub ? getDubEpisodes(animeId).map(number => ({ number, title: 'English dub' })) : media.info?.episodes || [];
  return <div className="anime-room-options" aria-label="Room anime">
    <p><strong>{title}</strong> · Episode {episode}</p>
    <div className="anime-audio-availability" role="group" aria-label="Anime audio"><span>Audio</span>
      <button type="button" aria-pressed={!dub} disabled={blocked || !dub} onClick={() => select({ source: 'anime', id: animeId, episode, title, position: 0 })}>Sub</button>
      <button type="button" aria-pressed={Boolean(dub)} disabled={blocked || Boolean(dub) || !dubChoice} onClick={() => select(dubChoice)}>Dub</button>
      <p>{dubChoice ? `The host changes audio for everyone. Switching sources restarts the episode. English dub: ${getDubProvider(animeId)} on YouTube.` : 'No verified Dub source is available for this episode. Subtitles change captions only.'}</p>
    </div>
    {episodes.length > 0 && <EpisodeNavigator episodes={episodes} selectedNumber={episode} disabled={blocked} onSelect={item => select(dub ? getDubSelection(animeId, item.number, title) : { source: 'anime', id: animeId, episode: item.number, title })} />}
    {!dub && media.subtitles?.length > 0 && <label>Anime subtitles<select key={media.sourceUrl} defaultValue={media.subtitles.findIndex(track => track.language === 'en')}
      onChange={event => { const tracks = videoRef?.current?.textTracks; if (tracks) Array.from(tracks).forEach((track, index) => { track.mode = index === Number(event.target.value) ? 'showing' : 'disabled'; }); }}>
      <option value={-1}>Off</option>{media.subtitles.map((track, index) => <option key={track.src} value={index}>{track.label}</option>)}
    </select></label>}
  </div>;
}
