import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

const logger = Logger.create('memory');

export interface MemoryConfig {
  enabled: boolean;
  type: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class MemoryManager {
  private config: MemoryConfig;
  private storePath: string;
  private store: Map<string, MemoryEntry> = new Map();

  constructor(config: MemoryConfig, baseDir: string) {
    this.config = config;
    this.storePath = path.join(baseDir, 'memory');

    if (config.enabled) {
      this.ensureDirectory();
      this.loadFromDisk();
    }
  }

  set(key: string, value: string, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const entry: MemoryEntry = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      key,
      value,
      timestamp: Date.now(),
      metadata,
    };

    this.store.set(key, entry);
    this.saveToDisk();
    logger.debug(`Memory set: ${key}`);
  }

  get(key: string): string | null {
    if (!this.config.enabled) return null;
    const entry = this.store.get(key);
    return entry ? entry.value : null;
  }

  delete(key: string): boolean {
    if (!this.config.enabled) return false;
    const deleted = this.store.delete(key);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  list(): MemoryEntry[] {
    return Array.from(this.store.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return this.list().filter(
      (entry) =>
        entry.key.toLowerCase().includes(lower) ||
        entry.value.toLowerCase().includes(lower)
    );
  }

  getContext(): string {
    if (!this.config.enabled || this.store.size === 0) return '';

    const entries = this.list().slice(0, 20); // Last 20 entries
    const lines = entries.map(
      (e) => `[${e.key}]: ${e.value}`
    );
    return `Remembered context:\n${lines.join('\n')}`;
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }
  }

  private loadFromDisk(): void {
    const filePath = path.join(this.storePath, 'store.json');
    if (!fs.existsSync(filePath)) return;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entries: MemoryEntry[] = JSON.parse(raw);
      for (const entry of entries) {
        this.store.set(entry.key, entry);
      }
      logger.info(`Loaded ${entries.length} memory entries`);
    } catch (err) {
      logger.warn(`Failed to load memory: ${err}`);
    }
  }

  private saveToDisk(): void {
    const filePath = path.join(this.storePath, 'store.json');
    const entries = Array.from(this.store.values());
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }
}
