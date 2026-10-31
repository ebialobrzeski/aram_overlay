import https from 'node:https';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { log, safeJson } from './log';

export interface LcuCreds { port: number; password: string; pid?: number }

const LOCKFILE_CANDIDATES = [
  process.env.LCU_LOCKFILE,
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
].filter((p): p is string => !!p);

/** Find the running client via its command line (fresh) or the lockfile (fallback). */
export async function discover(): Promise<LcuCreds | null> {
  const fromProcess = await discoverFromProcess().catch(() => null);
  if (fromProcess) return fromProcess;
  for (const file of LOCKFILE_CANDIDATES) {
    try {
      const text = await readFile(file, 'utf8');
      const [, pid, port, password] = text.trim().split(':');
      if (port && password) return { port: Number(port), password, pid: Number(pid) };
    } catch { /* not there */ }
  }
  return null;
}

function discoverFromProcess(): Promise<LcuCreds | null> {
  return new Promise(resolve => {
    const cmd = "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine) -join \"`n\"";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const port = /--app-port=(\d+)/.exec(stdout)?.[1];
      const password = /--remoting-auth-token=([\w-]+)/.exec(stdout)?.[1];
      if (port && password) resolve({ port: Number(port), password });
      else resolve(null);
    });
  });
}

export class LcuError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class Lcu {
  private agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  constructor(public creds: LcuCreds) {}

  async request<T = unknown>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const started = Date.now();
    try {
      const result = await this.requestRaw<T>(method, apiPath, body);
      log.debug(`LCU ${method} ${apiPath} ok ${Date.now() - started}ms`, log.debugEnabled ? safeJson(result, 800) : '');
      return result;
    } catch (e) {
      log.debug(`LCU ${method} ${apiPath} FAILED after ${Date.now() - started}ms: ${(e as Error).message}`);
      throw e;
    }
  }

  private requestRaw<T = unknown>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`riot:${this.creds.password}`).toString('base64');
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1', port: this.creds.port, method, path: apiPath, agent: this.agent, timeout: 4000,
        headers: {
          Authorization: `Basic ${auth}`, Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) return reject(new LcuError(res.statusCode, `${method} ${apiPath} -> ${res.statusCode} ${text.slice(0, 200)}`));
          if (!text) return resolve(undefined as T);
          try { resolve(JSON.parse(text) as T); } catch { resolve(text as unknown as T); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('LCU timeout')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  get<T = unknown>(apiPath: string): Promise<T> { return this.request<T>('GET', apiPath); }
  post<T = unknown>(apiPath: string, body?: unknown): Promise<T> { return this.request<T>('POST', apiPath, body); }

  /** GET that returns null on 404 and other HTTP errors (connection errors still throw). */
  async getOrNull<T = unknown>(apiPath: string): Promise<T | null> {
    try { return await this.get<T>(apiPath); }
    catch (e) { if (e instanceof LcuError) return null; throw e; }
  }

  /** Raw binary GET (icons). */
  getBuffer(apiPath: string): Promise<{ body: Buffer; type: string }> {
    const auth = Buffer.from(`riot:${this.creds.password}`).toString('base64');
    return new Promise((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port: this.creds.port, method: 'GET', path: apiPath, agent: this.agent, timeout: 6000, headers: { Authorization: `Basic ${auth}` } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) return reject(new LcuError(res.statusCode, `GET ${apiPath} -> ${res.statusCode}`));
          resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] ?? 'image/png') });
        });
      });
      req.on('timeout', () => req.destroy(new Error('LCU timeout')));
      req.on('error', reject);
      req.end();
    });
  }
}

export function describeCreds(c: LcuCreds): string { return `127.0.0.1:${c.port}`; }
export const LOCKFILE_HINT = path.basename(LOCKFILE_CANDIDATES[0] ?? 'lockfile');
