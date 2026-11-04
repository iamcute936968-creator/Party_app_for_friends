import { afterEach, expect, it, vi } from 'vitest';
import { createYouTubeAdapter } from '../../src/adapters/YouTubeAdapter';
afterEach(() => vi.unstubAllGlobals());
it('does not publish provider state before readiness, but forwards actual state afterward', () => {
  let events;
  vi.stubGlobal('YT', { Player: function(_id, options) { events = options.events; return {}; } });
  const adapter = createYouTubeAdapter('player', 'M7lc1UVf-VE'); const state = vi.fn(); const ready = vi.fn();
  adapter.onStateChange(state); adapter.onReady(ready);
  events.onStateChange({ data: 2 }); expect(state).not.toHaveBeenCalled();
  events.onReady(); expect(ready).toHaveBeenCalledOnce();
  events.onStateChange({ data: 2 }); expect(state).toHaveBeenCalledWith('PAUSED');
});
it('reports browser autoplay blocking separately from video errors and ignores it after teardown', () => {
  let events;
  vi.stubGlobal('YT', { Player: function (_id, options) { events = options.events; return { destroy: vi.fn() }; } });
  const adapter = createYouTubeAdapter('player', '468wQZH-KTo'), blocked = vi.fn(), error = vi.fn();
  adapter.onAutoplayBlocked(blocked); adapter.onError(error);
  events.onAutoplayBlocked(); expect(blocked).toHaveBeenCalledOnce(); expect(error).not.toHaveBeenCalled();
  adapter.destroy(); events.onAutoplayBlocked(); expect(blocked).toHaveBeenCalledOnce();
});
