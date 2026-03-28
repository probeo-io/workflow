import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../src/store.js';
import type { ItemState } from '../src/types.js';

function makeItemState(overrides: Partial<ItemState> = {}): ItemState {
  return {
    id: 'item-1',
    currentStep: 'step-a',
    status: 'pending',
    stepOutputs: {},
    attempts: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FileStore', () => {
  let tmpDir: string;
  let store: FileStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'workflow-test-'));
    store = new FileStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads item state', async () => {
    const item = makeItemState();
    await store.saveItem('wf-1', item);
    const loaded = await store.getItem('wf-1', 'item-1');
    expect(loaded).toEqual(item);
  });

  it('saves and loads step output', async () => {
    const output = { result: 'hello', score: 42 };
    await store.saveStepOutput('wf-1', 'item-1', 'step-a', output);
    const loaded = await store.getStepOutput('wf-1', 'item-1', 'step-a');
    expect(loaded).toEqual(output);
  });

  it('does not overwrite existing step output (immutability)', async () => {
    await store.saveStepOutput('wf-1', 'item-1', 'step-a', { v: 1 });
    await store.saveStepOutput('wf-1', 'item-1', 'step-a', { v: 2 });
    const loaded = await store.getStepOutput('wf-1', 'item-1', 'step-a');
    expect(loaded).toEqual({ v: 1 });
  });

  it('lists items in a workflow', async () => {
    const a = makeItemState({ id: 'a' });
    const b = makeItemState({ id: 'b' });
    await store.saveItem('wf-1', a);
    await store.saveItem('wf-1', b);
    const items = await store.listItems('wf-1');
    const ids = items.map(i => i.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('returns null for non-existent item', async () => {
    const result = await store.getItem('wf-1', 'nope');
    expect(result).toBeNull();
  });

  it('returns null for non-existent step output', async () => {
    const result = await store.getStepOutput('wf-1', 'item-1', 'nope');
    expect(result).toBeNull();
  });

  it('creates directories automatically', async () => {
    const deepStore = new FileStore(join(tmpDir, 'a', 'b', 'c'));
    const item = makeItemState();
    await deepStore.saveItem('wf-1', item);
    const loaded = await deepStore.getItem('wf-1', 'item-1');
    expect(loaded).toEqual(item);
  });

  it('isolates items between workflow IDs', async () => {
    const a = makeItemState({ id: 'item-1' });
    const b = makeItemState({ id: 'item-1', status: 'failed' });
    await store.saveItem('wf-a', a);
    await store.saveItem('wf-b', b);
    const loadedA = await store.getItem('wf-a', 'item-1');
    const loadedB = await store.getItem('wf-b', 'item-1');
    expect(loadedA!.status).toBe('pending');
    expect(loadedB!.status).toBe('failed');
  });

  it('returns empty array for non-existent workflow', async () => {
    const items = await store.listItems('does-not-exist');
    expect(items).toEqual([]);
  });
});
