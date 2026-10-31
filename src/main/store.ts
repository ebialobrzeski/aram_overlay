import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { DEFAULT_SETTINGS, PROFILES } from '../shared/scoring';

export interface Persisted {
  settings: Settings;
  bounds?: { x: number; y: number; width: number; height: number };
}

/** Tiny JSON settings store in the Electron userData folder. */
export class Store {
  private file: string;
  data: Persisted;

  constructor(userData: string) {
    this.file = path.join(userData, 'settings.json');
    this.data = { settings: { ...DEFAULT_SETTINGS } };
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>;
      this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}), weights: { ...DEFAULT_SETTINGS.weights, ...(raw.settings?.weights ?? {}) }, badges: { ...DEFAULT_SETTINGS.badges, ...(raw.settings?.badges ?? {}) } };
      this.data.bounds = raw.bounds;
    } catch { /* first run */ }
  }

  get settings(): Settings { return this.data.settings; }

  updateSettings(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.data.settings, ...patch };
    if (patch.profile && patch.profile !== this.data.settings.profile && PROFILES[patch.profile] && !patch.weights) {
      // switching profile resets the weights to that profile's defaults
      next.weights = { ...PROFILES[patch.profile].weights };
    }
    if (patch.badges) next.badges = { ...this.data.settings.badges, ...patch.badges };
    if (patch.weights) {
      next.weights = { ...this.data.settings.weights, ...patch.weights };
      // editing sliders while on Auto means the user wants their own weights
      if (next.profile === 'auto') next.profile = 'custom';
    }
    this.data.settings = next;
    this.save();
    return next;
  }

  setBounds(b: Persisted['bounds']) { this.data.bounds = b; this.save(); }

  private save() {
    try { writeFileSync(this.file, JSON.stringify(this.data, null, 2)); } catch { /* ignore */ }
  }
}
