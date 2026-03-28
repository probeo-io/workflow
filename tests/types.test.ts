import { describe, it, expect } from 'vitest';
import type { WorkItem, ItemState, Step, StepContext } from '../src/types.js';

describe('Type validation', () => {
  it('WorkItem has required fields', () => {
    const item: WorkItem<string> = { id: 'test-1', data: 'hello' };
    expect(item.id).toBe('test-1');
    expect(item.data).toBe('hello');
  });

  it('WorkItem supports complex data types', () => {
    const item: WorkItem<{ url: string; depth: number }> = {
      id: 'page-1',
      data: { url: 'https://example.com', depth: 2 },
    };
    expect(item.data.url).toBe('https://example.com');
    expect(item.data.depth).toBe(2);
  });

  it('ItemState has all required fields', () => {
    const state: ItemState = {
      id: 'item-1',
      currentStep: 'fetch',
      status: 'pending',
      stepOutputs: {},
      attempts: 0,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(state.status).toBe('pending');
    expect(state.error).toBeUndefined();
  });

  it('ItemState supports optional error field', () => {
    const state: ItemState = {
      id: 'item-1',
      currentStep: 'fetch',
      status: 'failed',
      stepOutputs: {},
      error: 'timeout',
      attempts: 3,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(state.error).toBe('timeout');
  });

  it('Step interface compliance for concurrent mode', () => {
    const step: Step<string, number> = {
      name: 'count-chars',
      mode: 'concurrent',
      run: async (input: string) => input.length,
    };
    expect(step.name).toBe('count-chars');
    expect(step.mode).toBe('concurrent');
  });

  it('Step interface compliance for collective mode', () => {
    const step: Step<string[], string> = {
      name: 'merge',
      mode: 'collective',
      run: async (inputs: string[]) => inputs.join(','),
    };
    expect(step.name).toBe('merge');
    expect(step.mode).toBe('collective');
  });
});
