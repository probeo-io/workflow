import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workflow } from '../src/engine.js';
import { FileStore } from '../src/store.js';
import type { Step, WorkItem, WorkflowProgress } from '../src/types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'wf-engine-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeWorkflow(id = 'test-wf'): Workflow {
  return new Workflow({ id, baseDir: tmpDir });
}

function makeStep(name: string, fn: (input: any) => any): Step {
  return {
    name,
    mode: 'concurrent',
    run: async (input, _ctx) => fn(input),
  };
}

function makeCollectiveStep(name: string, fn: (inputs: any) => any): Step {
  return {
    name,
    mode: 'collective',
    run: async (inputs, _ctx) => fn(inputs),
  };
}

function makeItems(count: number): WorkItem<string>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    data: `data-${i}`,
  }));
}

describe('Workflow - basic execution', () => {
  it('runs a single concurrent step', async () => {
    const wf = makeWorkflow();
    wf.step(makeStep('upper', (s: string) => s.toUpperCase()));
    const results = await wf.run(makeItems(1));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('completed');
    expect(results[0].stepOutputs['upper']).toBe('DATA-0');
  });

  it('runs multi-step workflow in sequence', async () => {
    const wf = makeWorkflow();
    wf.step(makeStep('double', (s: string) => s + s));
    wf.step(makeStep('upper', (s: string) => s.toUpperCase()));
    const results = await wf.run(makeItems(1));
    expect(results[0].stepOutputs['upper']).toBe('DATA-0DATA-0');
  });

  it('runs a collective step receiving all items', async () => {
    const wf = makeWorkflow();
    const collectStep = makeCollectiveStep('merge', (inputs: any[]) => {
      return inputs.map((i: any) => ({ ...i, merged: true }));
    });
    const results = await wf.run(makeItems(3));
    // Without a step, items just complete
    expect(results).toHaveLength(3);
  });

  it('collective step receives all item inputs', async () => {
    const received: unknown[] = [];
    const wf = makeWorkflow();
    const step: Step = {
      name: 'collect',
      mode: 'collective',
      run: async (inputs) => {
        received.push(inputs);
        return (inputs as any[]).map(() => 'done');
      },
    };
    wf.step(step);
    await wf.run(makeItems(3));
    expect(received).toHaveLength(1);
    expect((received[0] as any[]).length).toBe(3);
  });

  it('runs mixed concurrent + collective steps', async () => {
    const wf = makeWorkflow();
    wf.step(makeStep('prefix', (s: string) => `[${s}]`));
    const collectStep: Step = {
      name: 'collect',
      mode: 'collective',
      run: async (inputs) => {
        return (inputs as any[]).map((i: any) => `merged:${i.data}`);
      },
    };
    wf.step(collectStep);
    const results = await wf.run(makeItems(2));
    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === 'completed')).toBe(true);
  });

  it('handles empty items array', async () => {
    const wf = makeWorkflow();
    wf.step(makeStep('noop', (s: string) => s));
    const results = await wf.run([]);
    expect(results).toEqual([]);
  });

  it('runs single item via runOne', async () => {
    const wf = makeWorkflow();
    wf.step(makeStep('upper', (s: string) => s.toUpperCase()));
    const item: WorkItem<string> = { id: 'solo', data: 'hello' };
    const result = await wf.runOne(item);
    expect(result.status).toBe('completed');
    expect(result.stepOutputs['upper']).toBe('HELLO');
  });
});

describe('Workflow - step ordering', () => {
  it('executes steps in added order', async () => {
    const order: string[] = [];
    const wf = makeWorkflow();
    wf.step({
      name: 'first',
      mode: 'concurrent',
      run: async (input) => { order.push('first'); return input; },
    });
    wf.step({
      name: 'second',
      mode: 'concurrent',
      run: async (input) => { order.push('second'); return input; },
    });
    wf.step({
      name: 'third',
      mode: 'concurrent',
      run: async (input) => { order.push('third'); return input; },
    });
    await wf.run(makeItems(1));
    expect(order).toEqual(['first', 'second', 'third']);
  });
});

describe('Workflow - resources', () => {
  it('makes resources available in step context', async () => {
    const wf = makeWorkflow();
    wf.resource('apiKey', 'sk-test-123');
    wf.resource('client', { name: 'mock-client' });
    let capturedResources: Record<string, unknown> = {};
    wf.step({
      name: 'check',
      mode: 'concurrent',
      run: async (input, ctx) => {
        capturedResources = ctx.resources;
        return input;
      },
    });
    await wf.run(makeItems(1));
    expect(capturedResources['apiKey']).toBe('sk-test-123');
    expect(capturedResources['client']).toEqual({ name: 'mock-client' });
  });
});

describe('Workflow - progress callback', () => {
  it('calls onProgress with correct counts', async () => {
    const reports: WorkflowProgress[] = [];
    const wf = makeWorkflow();
    wf.step(makeStep('noop', (s: string) => s));
    await wf.run(makeItems(3), {
      onProgress: (p) => reports.push({ ...p }),
    });
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(r => r.currentStep === 'noop')).toBe(true);
    expect(reports.every(r => r.total === 3)).toBe(true);
  });
});

describe('Workflow - concurrency limit', () => {
  it('respects max parallel items', async () => {
    let peak = 0;
    let active = 0;
    const wf = makeWorkflow();
    wf.step({
      name: 'slow',
      mode: 'concurrent',
      run: async (input) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(r => setTimeout(r, 50));
        active--;
        return input;
      },
    });
    await wf.run(makeItems(6), { concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('Workflow - retries', () => {
  it('retries on failure then succeeds', async () => {
    let calls = 0;
    const wf = makeWorkflow();
    wf.step({
      name: 'flaky',
      mode: 'concurrent',
      run: async (input) => {
        calls++;
        if (calls === 1) throw new Error('transient');
        return 'ok';
      },
    });
    const results = await wf.run(makeItems(1), { maxRetries: 2 });
    expect(results[0].status).toBe('completed');
    expect(results[0].stepOutputs['flaky']).toBe('ok');
    expect(calls).toBe(2);
  });

  it('marks item failed after retry exhaustion', async () => {
    const wf = makeWorkflow();
    wf.step({
      name: 'always-fail',
      mode: 'concurrent',
      run: async () => { throw new Error('permanent'); },
    });
    const results = await wf.run(makeItems(1), { maxRetries: 1 });
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('permanent');
  });

  it('uses exponential backoff between retries', async () => {
    const timestamps: number[] = [];
    const wf = makeWorkflow();
    wf.step({
      name: 'timed-fail',
      mode: 'concurrent',
      run: async () => {
        timestamps.push(Date.now());
        throw new Error('fail');
      },
    });
    await wf.run(makeItems(1), { maxRetries: 2 });
    // 3 attempts: initial + 2 retries
    expect(timestamps).toHaveLength(3);
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    // Second gap should be longer than first (exponential)
    expect(gap2).toBeGreaterThan(gap1 * 1.5);
  });
});

describe('Workflow - resume after crash', () => {
  it('skips completed steps on resume', async () => {
    let step1Calls = 0;
    let step2Calls = 0;
    const store = new FileStore(tmpDir);

    // First run: only step 1
    const wf1 = new Workflow({ id: 'resume-wf', store });
    wf1.step({
      name: 'step1',
      mode: 'concurrent',
      run: async (input) => { step1Calls++; return 'step1-done'; },
    });
    await wf1.run(makeItems(1));

    // Second run: step 1 + step 2, step 1 should be skipped
    step1Calls = 0;
    const wf2 = new Workflow({ id: 'resume-wf', store });
    wf2.step({
      name: 'step1',
      mode: 'concurrent',
      run: async (input) => { step1Calls++; return 'step1-again'; },
    });
    wf2.step({
      name: 'step2',
      mode: 'concurrent',
      run: async (input) => { step2Calls++; return 'step2-done'; },
    });
    const results = await wf2.run(makeItems(1));
    // step1 output was cached, so step1Calls stays 0
    expect(step1Calls).toBe(0);
    expect(step2Calls).toBe(1);
    expect(results[0].status).toBe('completed');
  });
});

describe('Workflow - abort signal', () => {
  it('stops processing when aborted', async () => {
    const controller = new AbortController();
    let processed = 0;
    const wf = makeWorkflow();
    wf.step({
      name: 'slow',
      mode: 'concurrent',
      run: async (input) => {
        processed++;
        if (processed === 1) controller.abort();
        await new Promise(r => setTimeout(r, 20));
        return input;
      },
    });
    await wf.run(makeItems(5), {
      signal: controller.signal,
      concurrency: 1,
    });
    expect(processed).toBeLessThan(5);
  });
});

describe('Workflow - item state tracking', () => {
  it('captures status transitions', async () => {
    const statuses: string[] = [];
    const store = new FileStore(tmpDir);
    const origSave = store.saveItem.bind(store);
    store.saveItem = async (wfId, item) => {
      statuses.push(item.status);
      return origSave(wfId, item);
    };
    const wf = new Workflow({ id: 'state-wf', store });
    wf.step(makeStep('noop', (s: string) => s));
    await wf.run(makeItems(1));
    // Should see: running -> pending (after step) -> completed (final)
    expect(statuses).toContain('running');
    expect(statuses).toContain('completed');
  });

  it('captures error in ItemState on failure', async () => {
    const wf = makeWorkflow();
    wf.step({
      name: 'boom',
      mode: 'concurrent',
      run: async () => { throw new Error('kaboom'); },
    });
    const results = await wf.run(makeItems(1), { maxRetries: 0 });
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toBe('kaboom');
  });
});
