import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Minimal logger: always prints to the console; in debug mode also appends to <userData>/debug.log. */
class Logger {
  debugEnabled = false;
  private file: string | null = null;

  init(userData: string, debug: boolean) {
    this.debugEnabled = debug;
    if (!debug) return;
    this.file = path.join(userData, 'debug.log');
    try { writeFileSync(this.file, `=== ARAM overlay debug log started ${new Date().toISOString()} ===\n`); } catch { this.file = null; }
    this.info('Debug logging to', this.file);
  }

  get filePath() { return this.file; }

  info(...args: unknown[]) { this.write('INFO', args); }
  warn(...args: unknown[]) { this.write('WARN', args); }
  error(...args: unknown[]) { this.write('ERROR', args); }
  debug(...args: unknown[]) { if (this.debugEnabled) this.write('DEBUG', args); }

  private write(level: string, args: unknown[]) {
    const text = args.map(a => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : safeJson(a))).join(' ');
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${text}`;
    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(line);
    if (this.file) { try { appendFileSync(this.file, line + '\n'); } catch { /* ignore */ } }
  }
}

export function safeJson(v: unknown, max = 4000): string {
  try { const s = JSON.stringify(v); return s.length > max ? s.slice(0, max) + `…(${s.length} chars)` : s; } catch { return String(v); }
}

export const log = new Logger();
