'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSound } from './SoundContext';
import { SOUND_MANIFEST, SHARED_SFX, CLICK_VARIANTS, CHIP_VARIANTS } from './manifest';

// Decoded buffers are cached by URL so repeated plays (and multiple games
// sharing a sound) don't re-fetch/re-decode every time.
const bufferCache = new Map<string, Promise<AudioBuffer>>();

// Looping background music sits under one-shot SFX so it doesn't drown them
// out — relative to the master volume, not a second independent slider.
const MUSIC_LEVEL = 0.5;

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let cached = bufferCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    bufferCache.set(url, cached);
  }
  return cached;
}

/**
 * Per-game audio: loops `music` while the calling component is mounted, and
 * exposes `playSfx(name)` for one-shot effects (falling back to the shared
 * click/chip pool if this game doesn't define `name` itself), plus
 * `playClick()`/`playChip()` for the common "selected a value" / "play
 * button" / "bet amount" interactions every game has. All route through the
 * shared master gain, so they respect the sidebar volume control. Missing
 * urls are no-ops, so this is always safe to call even before real assets
 * exist for a given game.
 */
export function useGameAudio(gameKey: string) {
  const { getMasterGain } = useSound();
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const loopSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const loopGenRef = useRef(0);

  useEffect(() => {
    const musicUrl = SOUND_MANIFEST[gameKey]?.music;
    if (!musicUrl) return;
    const graph = getMasterGain();
    if (!graph) return;

    let cancelled = false;
    loadBuffer(graph.ctx, musicUrl).then((buffer) => {
      if (cancelled) return;
      const musicGain = graph.ctx.createGain();
      musicGain.gain.value = MUSIC_LEVEL;
      musicGain.connect(graph.gain);

      const source = graph.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(musicGain);
      source.start();
      musicSourceRef.current = source;
    }).catch(() => {});

    return () => {
      cancelled = true;
      musicSourceRef.current?.stop();
      musicSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey]);

  const resolveUrl = useCallback(
    (name: string) => SOUND_MANIFEST[gameKey]?.sfx?.[name] ?? SHARED_SFX[name],
    [gameKey]
  );

  const playByUrl = useCallback((url: string | undefined) => {
    if (!url) return;
    const graph = getMasterGain();
    if (!graph) return;
    loadBuffer(graph.ctx, url).then((buffer) => {
      const source = graph.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(graph.gain);
      source.start();
    }).catch(() => {});
  }, [getMasterGain]);

  const playSfx = useCallback((name: string) => playByUrl(resolveUrl(name)), [playByUrl, resolveUrl]);

  // Picks one random name (from the ones that actually resolve to a url) and
  // plays it — used for win/lose variants and for the click/chip pools.
  const playRandom = useCallback((names: string[]) => {
    const pool = names.filter((n) => resolveUrl(n));
    if (pool.length === 0) return;
    playByUrl(resolveUrl(pool[Math.floor(Math.random() * pool.length)]));
  }, [playByUrl, resolveUrl]);

  const playClick = useCallback(() => playRandom(CLICK_VARIANTS), [playRandom]);
  const playChip = useCallback(() => playRandom(CHIP_VARIANTS), [playRandom]);

  // One-shot SFX on its own GainNode so it can be faded — automatically near
  // the natural end of the clip (`tailFadeMs`, so it never just cuts off),
  // and/or on demand via the returned handle's stop() (e.g. dismissing the
  // result before the clip finished). Independent of playSfx/playByUrl,
  // which have no per-instance gain to fade.
  const playFading = useCallback((name: string, tailFadeMs = 0) => {
    const url = resolveUrl(name);
    if (!url) return null;
    const graph = getMasterGain();
    if (!graph) return null;

    const gainNode = graph.ctx.createGain();
    gainNode.connect(graph.gain);
    let source: AudioBufferSourceNode | null = null;
    let stopped = false;

    loadBuffer(graph.ctx, url).then((buffer) => {
      if (stopped) return;
      source = graph.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNode);
      source.start();
      if (tailFadeMs > 0) {
        const tail = Math.min(tailFadeMs / 1000, buffer.duration);
        const fadeStart = graph.ctx.currentTime + buffer.duration - tail;
        gainNode.gain.setValueAtTime(1, fadeStart);
        gainNode.gain.linearRampToValueAtTime(0, fadeStart + tail);
      }
    }).catch(() => {});

    const stop = (fadeMs = 150) => {
      if (stopped) return;
      stopped = true;
      const now = graph.ctx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      setTimeout(() => { try { source?.stop(); } catch {} }, fadeMs + 30);
    };

    return { stop };
  }, [getMasterGain, resolveUrl]);

  // Looping one-shot SFX (e.g. a wheel/reel "spinning" idle), explicitly
  // started and stopped by the caller — unlike `music`, this isn't tied to
  // mount/unmount, it's tied to whatever in-page "is it spinning" state the
  // game tracks. `loopGenRef` discards a stale start if stop() (or a newer
  // start()) ran before the buffer finished loading.
  const stopLoop = useCallback(() => {
    loopGenRef.current += 1;
    loopSourceRef.current?.stop();
    loopSourceRef.current = null;
  }, []);

  const startLoop = useCallback((name: string) => {
    const url = resolveUrl(name);
    if (!url) return;
    const graph = getMasterGain();
    if (!graph) return;
    loopSourceRef.current?.stop();
    loopSourceRef.current = null;
    const gen = ++loopGenRef.current;
    loadBuffer(graph.ctx, url).then((buffer) => {
      if (gen !== loopGenRef.current) return;
      const source = graph.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(graph.gain);
      source.start();
      loopSourceRef.current = source;
    }).catch(() => {});
  }, [getMasterGain, resolveUrl]);

  // Safety net: stop any active loop if the page unmounts while it's playing.
  useEffect(() => stopLoop, [stopLoop]);

  return { playSfx, playRandom, playClick, playChip, startLoop, stopLoop, playFading };
}
