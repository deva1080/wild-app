'use client';

import React from 'react';
import { Info, X } from 'lucide-react';

/**
 * Trigger button for GameInfoModal. Shared so every game's info icon
 * looks and behaves identically.
 */
export function GameInfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 w-8 rounded-lg border border-amber-400/30 bg-zinc-900/70 text-amber-300 hover:bg-zinc-800/80 hover:border-amber-400/60 transition-colors flex items-center justify-center"
      aria-label="Show game rules"
      title="Game rules"
    >
      <Info className="w-4 h-4" />
    </button>
  );
}

export type GameInfoSection = {
  title: string;
  content: React.ReactNode;
};

export function GameInfoModal({
  open,
  onClose,
  icon,
  title,
  description,
  steps,
  sections,
  tip,
  rtp,
}: {
  open: boolean;
  onClose: () => void;
  icon?: React.ReactNode;
  title: string;
  description: string;
  steps?: string[];
  sections?: GameInfoSection[];
  tip?: string;
  /** Shown as small, unobtrusive fine print — same treatment slots give their RTP. */
  rtp?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-[#121212] shadow-[0_0_40px_rgba(0,0,0,0.65)] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-amber-400/15 sticky top-0 bg-[#121212]">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-amber-300 shrink-0">{icon}</span>}
            <h3
              className="text-sm font-black uppercase tracking-widest truncate"
              style={{
                background: 'linear-gradient(20deg, #debc6e, #8c6825)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-zinc-300 leading-relaxed">{description}</p>

          {steps && steps.length > 0 && (
            <div>
              <p className="text-[11px] text-zinc-400 uppercase tracking-widest mb-2 font-bold">
                How to play
              </p>
              <ol className="space-y-1.5">
                {steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-zinc-300">
                    <span className="shrink-0 h-5 w-5 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-300 text-[10px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {sections?.map((section) => (
            <div
              key={section.title}
              className="rounded-lg border border-zinc-700/70 bg-zinc-900/50 p-3"
            >
              <p className="text-[11px] text-zinc-400 uppercase tracking-widest mb-2 font-bold">
                {section.title}
              </p>
              {section.content}
            </div>
          ))}

          {tip && (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200/90 flex gap-2">
              <span className="shrink-0">💡</span>
              <span>{tip}</span>
            </div>
          )}

          {rtp && <p className="text-[10px] text-zinc-600 text-right">RTP {rtp}</p>}
        </div>
      </div>
    </div>
  );
}
