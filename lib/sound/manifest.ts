// Per-game sound assets. `music` loops while the game page is mounted; `sfx`
// are one-shot effects keyed by name (e.g. 'win', 'lose', 'launch').
//
// Games starting with `{}` are placeholders — useGameAudio() no-ops when a
// url is missing, so it's safe to call playSfx()/playClick()/playChip() from
// every game right now. Drop real files into /public/sounds/<game>/... and
// fill in the urls below as they're produced; no other code needs to change.
export interface GameSoundManifest {
  music?: string;
  sfx?: Record<string, string>;
}

// Sounds shared by every game (not tied to a single game's manifest entry):
// UI clicks for selecting a value, and chip clacks for bet-amount controls.
// Multiple variants per action exist purely so repeated presses don't sound
// identical — useGameAudio's playClick()/playChip() pick one at random.
export const SHARED_SFX: Record<string, string> = {
  click1: '/sounds/generals/click-1.mp3',
  click2: '/sounds/generals/click-2.mp3',
  click3: '/sounds/generals/click-3.mp3',
  chip1: '/sounds/generals/chip-1.mp3',
  chip2: '/sounds/generals/chip-2.mp3',
  coinRain: '/sounds/generals/cae-lluvia-moneda-2.mp3',
  defaultResult: '/sounds/generals/default-result.mp3',
};

export const CLICK_VARIANTS = ['click1', 'click2', 'click3'];
export const CHIP_VARIANTS = ['chip1', 'chip2'];

export const SOUND_MANIFEST: Record<string, GameSoundManifest> = {
  crash: {
    music: '/sounds/crash/crash-iddle.mp3',
    sfx: {
      launch: '/sounds/crash/crash-launch.mp3',
      win: '/sounds/crash/crash-win.mp3',
      winAlt: '/sounds/crash/crash-win-2.mp3',
      lose: '/sounds/crash/crash-lose.mp3',
      loseAlt: '/sounds/crash/crash-lose-2.mp3',
    },
  },
  rocket: {},
  frogger: {},
  flip: {
    sfx: {
      flip: '/sounds/flip/coin-flip-1.mp3',
      end: '/sounds/flip/coin-end.mp3',
    },
  },
  rps: {
    sfx: {
      card1: '/sounds/hilo/card-1.mp3',
      card2: '/sounds/hilo/card-2.mp3',
      loss: '/sounds/hilo/card-loss.mp3',
    },
  },
  wheel: {
    sfx: {
      spin: '/sounds/wheel/iddle-wheel-gira.mp3',
    },
  },
  plinko: {
    sfx: {
      bounce: '/sounds/plinko/rebotes.mp3',
      bucket: '/sounds/plinko/bucket.mp3',
    },
  },
  hilo: {
    sfx: {
      card1: '/sounds/hilo/card-1.mp3',
      card2: '/sounds/hilo/card-2.mp3',
      loss: '/sounds/hilo/card-loss.mp3',
    },
  },
  dice: {
    sfx: {
      roll: '/sounds/dice/dados-1.mp3',
    },
  },
  keno: {
    sfx: {
      card1: '/sounds/hilo/card-1.mp3',
      card2: '/sounds/hilo/card-2.mp3',
    },
  },
  slot: {},
  modernslot: {},
};
