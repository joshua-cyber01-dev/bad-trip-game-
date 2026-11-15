// localStorage wrapper that never throws (private mode, sandboxed iframes, ...).
const PFX = 'badtrip.';

export function load<T extends object>(key: string, def: T): T {
  try {
    const s = localStorage.getItem(PFX + key);
    return s ? { ...def, ...JSON.parse(s) } : { ...def };
  } catch {
    return { ...def };
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PFX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface BtnPos { x: number; y: number }

export interface Settings {
  quality: 'auto' | 'low' | 'mid' | 'high';
  fps: 60 | 30;
  sens: number;
  volume: number;
  invertY: boolean;
  lefty: boolean;
  haptics: boolean;
  showFps: boolean;
  btnScale: number;
  layout: Record<string, BtnPos>;
}

/** Button centres in % of the viewport (right-handed layout). */
export const DEFAULT_LAYOUT: Record<string, BtnPos> = {
  sprint: { x: 88, y: 70 },
  crouch: { x: 75, y: 84 },
  interact: { x: 73, y: 50 },
};

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  fps: 60,
  sens: 1,
  volume: 0.8,
  invertY: false,
  lefty: false,
  haptics: true,
  showFps: false,
  btnScale: 1,
  layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
};

export interface Progress { done: Record<string, number> } // level id -> best time (s)
