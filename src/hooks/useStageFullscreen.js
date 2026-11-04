import { useCallback, useEffect, useRef, useState } from 'react';

export function useStageFullscreen(containerRef, roomId) {
  const [active, setActive] = useState(false);
  const wanted = useRef(false);
  useEffect(() => {
    const element = containerRef.current;
    wanted.current = false; setActive(false);
    const changed = () => {
      if (document.fullscreenElement === element && element) {
        if (wanted.current) setActive(true);
        else void document.exitFullscreen?.().catch(() => {});
      } else if (wanted.current && element?.getAttribute('data-chat-open') === 'true' && element.contains(document.activeElement)) {
        // Mobile keyboards can exit native fullscreen. Keep the same stage open.
        setActive(true);
      } else { wanted.current = false; setActive(false); }
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      wanted.current = false;
      document.removeEventListener('fullscreenchange', changed);
      if (element && document.fullscreenElement === element) void document.exitFullscreen?.().catch(() => {});
    };
  }, [containerRef, roomId]);
  useEffect(() => {
    if (!active) return;
    const element = containerRef.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const viewport = window.visualViewport;
    const resize = () => {
      element?.style.setProperty('--stage-height', `${viewport?.height || window.innerHeight}px`);
      element?.style.setProperty('--stage-top', `${viewport?.offsetTop || 0}px`);
      // Native fullscreen sizing can ignore the keyboard's smaller visual viewport.
      if (document.fullscreenElement === element && element?.getAttribute('data-chat-open') === 'true' &&
        element.contains(document.activeElement) && viewport?.height < window.innerHeight - 100) {
        void document.exitFullscreen?.().catch(() => {});
      }
    };
    resize();
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      document.body.style.overflow = previous;
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      element?.style.removeProperty('--stage-height'); element?.style.removeProperty('--stage-top');
    };
  }, [active, containerRef]);
  const toggle = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    if (wanted.current) {
      wanted.current = false; setActive(false);
      if (document.fullscreenElement === element) void document.exitFullscreen?.().catch(() => {});
      return;
    }
    wanted.current = true; setActive(true);
    try {
      void Promise.resolve(element.requestFullscreen?.()).then(() => {
        if (!wanted.current && document.fullscreenElement === element) void document.exitFullscreen?.().catch(() => {});
      }).catch(() => { /* The immersive CSS stage is the native-API fallback. */ });
    } catch { /* Keep the same accessible controls in immersive mode. */ }
  }, [containerRef]);
  return { active, toggle };
}
