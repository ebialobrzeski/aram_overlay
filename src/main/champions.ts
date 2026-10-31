import https from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Champion } from '../shared/types';
import { CURATED, CURATED_BY_ALIAS, CURATED_BY_ID, traitsFromTags } from '../shared/champion_data';
import type { Lcu } from './lcu';

interface LcuChampionSummary { id: number; name: string; alias: string; roles?: string[] }
interface DdragonChampion { key: string; id: string; name: string; tags: string[]; stats?: { attackrange?: number } }

/**
 * Registry of champions known to the app. Curated traits win; champions missing from the curated table
 * get rough traits from their role tags so new releases still get ranked (flagged as not curated in the UI).
 */
export class ChampionRegistry {
  private byId = new Map<number, Champion>(CURATED.map(c => [c.id, c]));
  private byName = new Map<string, Champion>();
  ddragonVersion: string | null = null;
  source: 'curated' | 'lcu' | 'ddragon' = 'curated';
  private cacheFile: string;

  constructor(private userData: string) {
    this.cacheFile = path.join(userData, 'champions-cache.json');
    this.rebuildNames();
  }

  get(id: number): Champion | undefined { return this.byId.get(id); }
  all(): Champion[] { return [...this.byId.values()]; }

  /** Resolve a user-typed champion name ("kai'sa", "wukong", "MonkeyKing") to a champion. */
  find(text: string): Champion | undefined {
    return this.byName.get(normalize(text));
  }

  /** Try the local client first (works offline), then Data Dragon, then the on-disk cache. */
  async load(lcu: Lcu | null): Promise<void> {
    if (lcu) {
      try {
        const list = await lcu.get<LcuChampionSummary[]>('/lol-game-data/assets/v1/champion-summary.json');
        this.merge(list.filter(c => c.id > 0).map(c => ({ id: c.id, alias: c.alias, name: c.name, tags: c.roles ?? [] })));
        this.source = 'lcu';
        await this.saveCache();
        return;
      } catch { /* fall through */ }
    }
    try {
      const versions = await fetchJson<string[]>('https://ddragon.leagueoflegends.com/api/versions.json');
      this.ddragonVersion = versions[0];
      const data = await fetchJson<{ data: Record<string, DdragonChampion> }>(`https://ddragon.leagueoflegends.com/cdn/${this.ddragonVersion}/data/en_US/champion.json`);
      this.merge(Object.values(data.data).map(c => ({ id: Number(c.key), alias: c.id, name: c.name, tags: c.tags, attackRange: c.stats?.attackrange })));
      this.source = 'ddragon';
      await this.saveCache();
      return;
    } catch { /* offline */ }
    try {
      const cached = JSON.parse(await readFile(this.cacheFile, 'utf8')) as { version: string | null; list: { id: number; alias: string; name: string; tags: string[] }[] };
      this.ddragonVersion = cached.version;
      this.merge(cached.list);
    } catch { /* keep curated only */ }
  }

  async loadDdragonVersion(): Promise<void> {
    if (this.ddragonVersion) return;
    try { this.ddragonVersion = (await fetchJson<string[]>('https://ddragon.leagueoflegends.com/api/versions.json'))[0]; } catch { /* offline */ }
  }

  private merge(list: { id: number; alias: string; name: string; tags: string[]; attackRange?: number }[]) {
    for (const c of list) {
      const curated = CURATED_BY_ID.get(c.id) ?? CURATED_BY_ALIAS.get(c.alias.toLowerCase());
      if (curated) this.byId.set(c.id, { ...curated, id: c.id, name: c.name || curated.name, alias: c.alias || curated.alias });
      else this.byId.set(c.id, { id: c.id, alias: c.alias, name: c.name, traits: traitsFromTags(c.tags, c.attackRange), curated: false });
    }
    this.rebuildNames();
  }

  private rebuildNames() {
    this.byName.clear();
    for (const c of this.byId.values()) {
      this.byName.set(normalize(c.name), c);
      this.byName.set(normalize(c.alias), c);
    }
    this.byName.set('wukong', this.byName.get('monkeyking') ?? this.byName.get('wukong')!);
  }

  private async saveCache() {
    const list = this.all().map(c => ({ id: c.id, alias: c.alias, name: c.name, tags: [] as string[] }));
    await writeFile(this.cacheFile, JSON.stringify({ version: this.ddragonVersion, list })).catch(() => undefined);
  }

  /** Icon URL for the renderer. `lcu://` is served by the main process when the client is running. */
  iconUrl(id: number, lcuConnected: boolean): string {
    if (lcuConnected) return `lcu://champion-icon/${id}`;
    const alias = this.byId.get(id)?.alias;
    if (this.ddragonVersion && alias) return `https://ddragon.leagueoflegends.com/cdn/${this.ddragonVersion}/img/champion/${alias}.png`;
    return '';
  }
}

export function normalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error(`${url} -> ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
