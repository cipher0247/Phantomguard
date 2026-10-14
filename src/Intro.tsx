import { useCallback, useEffect, useRef, useState } from 'react';

// Module-level: survives React StrictMode double-mounts and route changes; resets only on a new app launch (page load).
let introFinished = false;
export const resetIntroForTests = () => { introFinished = false; };
export const shouldShowIntro = () => !introFinished;

const SRC = '/intro/phantomguard_intro.mp4';
const START_TIMEOUT_MS = 4000; // if playback has not begun, treat as failure and continue
const FALLBACK_MS = 1600;

export function Intro({ onDone }: { onDone: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const [phase, setPhase] = useState<'playing' | 'fallback' | 'leaving'>('playing');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    introFinished = true;
    setPhase('leaving');
    setTimeout(onDone, reduced ? 0 : 350); // let the fade complete so there is no flash
  }, [onDone, reduced]);

  useEffect(() => {
    if (reduced) return; // reduced motion: static branded splash only
    const v = video.current;
    if (!v) return;
    const fail = () => { if (!done.current) setPhase('fallback'); };
    const watchdog = setTimeout(() => { if (v.currentTime === 0) fail(); }, START_TIMEOUT_MS);
    // Start playback only once the player has data to play.
    const start = () => { v.play().catch(fail); };
    v.addEventListener('canplay', start, { once: true });
    v.src = SRC;
    v.load();
    return () => {
      clearTimeout(watchdog);
      v.removeEventListener('canplay', start);
      v.pause(); v.removeAttribute('src'); v.load(); // release decoder
    };
  }, [reduced]);

  useEffect(() => {
    if (!reduced && phase !== 'fallback') return;
    const t = setTimeout(finish, FALLBACK_MS);
    return () => clearTimeout(t);
  }, [phase, reduced, finish]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (['Escape', 'Enter', ' '].includes(e.key)) finish(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [finish]);

  const showSplash = phase === 'fallback' || reduced;
  return (
    <div role="dialog" aria-label="PHANTOMGUARD intro" data-testid="intro"
      className={`fixed inset-0 z-[100] bg-black flex items-center justify-center transition-opacity duration-300 ${phase === 'leaving' ? 'opacity-0' : 'opacity-100'}`}>
      {!showSplash && (
        <video ref={video} muted playsInline preload="auto" onEnded={finish} onError={() => setPhase('fallback')}
          className="w-full h-full object-contain pointer-events-none" aria-hidden="true" />
      )}
      {showSplash && (
        <div className="flex flex-col items-center gap-4 text-center" data-testid="intro-fallback">
          <img src="/logo.png" alt="" className="w-24 h-24 rounded-2xl object-contain" />
          <h1 className="font-headline text-3xl tracking-wide text-white">PHANTOM<span className="text-primary">GUARD</span></h1>
          <p className="text-xs text-white/60">Detect the invisible threats. Protect the human.</p>
        </div>
      )}
      <button onClick={finish}
        className="absolute right-4 top-4 min-h-[44px] px-4 rounded-full bg-white/15 text-white text-sm font-label backdrop-blur hover:bg-white/25">
        Skip intro
      </button>
    </div>
  );
}
