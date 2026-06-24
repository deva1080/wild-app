'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useSound } from '@/lib/sound/SoundContext';

/** Sidebar dropdown: a single master volume slider + mute, shared by every game. */
export function VolumeControl() {
  const { volume, muted, setVolume, toggleMuted } = useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const isMuted = muted || volume === 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full bg-[#1a1a1a] border border-amber-400/25 hover:border-amber-300/60 transition-colors rounded-lg px-3 py-2 text-[11px] font-medium tracking-wide text-zinc-200"
      >
        {isMuted ? <VolumeX className="w-3.5 h-3.5 text-amber-300" /> : <Volume2 className="w-3.5 h-3.5 text-amber-300" />}
        Sound
        <span className="ml-auto tabular-nums text-zinc-400">{isMuted ? 'Off' : `${Math.round(volume * 100)}%`}</span>
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-2 w-56 rounded-xl border border-amber-400/30 bg-[#0d1118] shadow-lg z-50 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">Volume</span>
            <button
              type="button"
              onClick={toggleMuted}
              className="text-[10px] font-bold text-amber-300 hover:text-amber-200 transition-colors"
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            className="w-full accent-amber-400"
          />
          <p className="text-[10px] text-zinc-500">Applies to music and effects in every game.</p>
        </div>
      )}
    </div>
  );
}
