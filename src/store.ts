import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowStore, ItemState } from './types.js';

/**
 * Filesystem-based workflow store.
 * Structure:
 *   {baseDir}/{workflowId}/{itemId}/state.json
 *   {baseDir}/{workflowId}/{itemId}/{stepName}.json
 *
 * All writes are immutable — step outputs are written once.
 */
export class FileStore implements WorkflowStore {
  private baseDir: string;

  constructor(baseDir = '.workflow') {
    this.baseDir = baseDir;
  }

  private itemDir(workflowId: string, itemId: string): string {
    return join(this.baseDir, workflowId, itemId);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async saveItem(workflowId: string, item: ItemState): Promise<void> {
    const dir = this.itemDir(workflowId, item.id);
    await this.ensureDir(dir);
    await writeFile(join(dir, 'state.json'), JSON.stringify(item, null, 2));
  }

  async getItem(workflowId: string, itemId: string): Promise<ItemState | null> {
    const path = join(this.itemDir(workflowId, itemId), 'state.json');
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  }

  async listItems(workflowId: string): Promise<ItemState[]> {
    const dir = join(this.baseDir, workflowId);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    const items: ItemState[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const item = await this.getItem(workflowId, entry.name);
        if (item) items.push(item);
      }
    }
    return items;
  }

  async saveStepOutput(workflowId: string, itemId: string, stepName: string, output: unknown): Promise<void> {
    const dir = this.itemDir(workflowId, itemId);
    await this.ensureDir(dir);
    const path = join(dir, `${stepName}.json`);
    // Immutable — skip if already exists
    if (existsSync(path)) return;
    await writeFile(path, JSON.stringify(output, null, 2));
  }

  async getStepOutput(workflowId: string, itemId: string, stepName: string): Promise<unknown | null> {
    const path = join(this.itemDir(workflowId, itemId), `${stepName}.json`);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  }
}
