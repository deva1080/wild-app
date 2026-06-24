'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const VOLUME_KEY = 'wc_sound_volume';
const MUTED_KEY = 'wc_sound_muted';
const DEFAULT_VOLUME = 0.6;

interface SoundContextValue {
  volume: number; // 0..1
  muted: boolean;
  setVolume: (v: number) => void;
  toggleMuted: () => void;
  /** Master gain every game's music/SFX must route through to respect the
   *  sidebar volume control. Lazily created on first call (browser-only). */
  getMasterGain: () => { ctx: AudioContext; gain: GainNode } | null;
}

const SoundContext = createContext<SoundContextValue | null>(null);

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [volume, setVolumeState] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const graphRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);

  // Restore persisted prefs on mount.
  useEffect(() => {
    const storedVolume = localStorage.getItem(VOLUME_KEY);
    const storedMuted = localStorage.getItem(MUTED_KEY);
    if (storedVolume !== null) {
      const v = parseFloat(storedVolume);
      if (Number.isFinite(v)) setVolumeState(Math.min(1, Math.max(0, v)));
    }
    if (storedMuted !== null) setMuted(storedMuted === '1');
  }, []);

  // Browsers won't let an AudioContext produce sound until it's resumed from
  // inside a user-gesture handler — wire that up once, globally.
  useEffect(() => {
    const resume = () => {
      graphRef.current?.ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, []);

  // Keep the live master gain in sync with volume/mute changes.
  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.gain.gain.value = muted ? 0 : volume;
    }
  }, [volume, muted]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    localStorage.setItem(VOLUME_KEY, String(clamped));
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem(MUTED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const getMasterGain = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (!graphRef.current) {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const gain = ctx.createGain();
      gain.gain.value = muted ? 0 : volume;
      gain.connect(ctx.destination);
      graphRef.current = { ctx, gain };
    }
    return graphRef.current;
  }, [muted, volume]);

  return (
    <SoundContext.Provider value={{ volume, muted, setVolume, toggleMuted, getMasterGain }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error('useSound must be used within SoundProvider');
  return ctx;
}
