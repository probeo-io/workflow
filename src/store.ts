import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowStore, ItemState } from './types.js';

/**
 * Filesystem-based workflow store.
 * Structure:
 *   {baseDir}/{workflowId}/_state/{itemId}.json
 *   {baseDir}/{workflowId}/{stepName}/{itemId}.json
 *
 * This gives a step-first layout under each workflow id.
 * All writes are immutable for step outputs — written once.
 */
export class FileStore implements WorkflowStore {
  private baseDir: string;

  constructor(baseDir = '.workflow') {
    this.baseDir = baseDir;
  }

  private stateDir(workflowId: string): string {
    return join(this.baseDir, workflowId, '_state');
  }

  private stepDir(workflowId: string, stepName: string): string {
    return join(this.baseDir, workflowId, stepName);
  }

  private statePath(workflowId: string, itemId: string): string {
    return join(this.stateDir(workflowId), `${itemId}.json`);
  }

  private stepPath(workflowId: string, stepName: string, itemId: string): string {
    return join(this.stepDir(workflowId, stepName), `${itemId}.json`);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async saveItem(workflowId: string, item: ItemState): Promise<void> {
    const dir = this.stateDir(workflowId);
    await this.ensureDir(dir);
    await writeFile(this.statePath(workflowId, item.id), JSON.stringify(item, null, 2));
  }

  async getItem(workflowId: string, itemId: string): Promise<ItemState | null> {
    const path = this.statePath(workflowId, itemId);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  }

  async listItems(workflowId: string): Promise<ItemState[]> {
    const dir = this.stateDir(workflowId);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const items: ItemState[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const itemId = entry.name.slice(0, -5);
      const item = await this.getItem(workflowId, itemId);
      if (item) items.push(item);
    }
    return items;
  }

  async saveStepOutput(workflowId: string, itemId: string, stepName: string, output: unknown): Promise<void> {
    const dir = this.stepDir(workflowId, stepName);
    await this.ensureDir(dir);
    const path = this.stepPath(workflowId, stepName, itemId);
    // Immutable — skip if already exists
    if (existsSync(path)) return;
    await writeFile(path, JSON.stringify(output, null, 2));
  }

  async getStepOutput(workflowId: string, itemId: string, stepName: string): Promise<unknown | null> {
    const path = this.stepPath(workflowId, stepName, itemId);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  }
}
