import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BadgeSettings, Settings } from '../shared/types';
import { DEFAULT_SETTINGS, PROFILES } from '../shared/scoring';

export interface Persisted {
  settings: Settings;
  bounds?: { x: number; y: number; width: number; height: number };
}

/**
 * Anchors saved by an older build could be degenerate (markers dragged over a mis-sized badge window end up
 * clamped to x=0 / x=1, or two anchors on top of each other); those are worse than the defaults, so drop them.
 */
export function sanitizeBadges(b: BadgeSettings): BadgeSettings {
  const d = DEFAULT_SETTINGS.badges;
  const inside = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99;
  const benchOk = inside(b.benchFirst) && inside(b.benchLast) && Math.abs(b.benchLast.x - b.benchFirst.x) > 0.05;
  const teamOk = inside(b.teamFirst) && inside(b.teamLast) && Math.abs(b.teamLast.y - b.teamFirst.y) > 0.05;
  if (benchOk && teamOk) return b;
  return {
    ...b,
    calibratedBy: 'none',
    benchFirst: benchOk ? b.benchFirst : d.benchFirst, benchLast: benchOk ? b.benchLast : d.benchLast,
    benchRef: benchOk ? b.benchRef : d.benchRef, benchAlign: benchOk ? b.benchAlign : d.benchAlign,
    teamFirst: teamOk ? b.teamFirst : d.teamFirst, teamLast: teamOk ? b.teamLast : d.teamLast,
  };
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
      this.data.settings.badges = sanitizeBadges(this.data.settings.badges);
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
