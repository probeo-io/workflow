import type {
  Step,
  StepContext,
  WorkItem,
  ItemState,
  WorkflowStore,
  WorkflowOptions,
  WorkflowProgress,
  Logger,
} from './types.js';
import { FileStore } from './store.js';

function generateId(prefix = 'wf'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createLogger(itemId: string, stepName: string): Logger {
  const prefix = `[${itemId}:${stepName}]`;
  return {
    info: (msg, data) => console.log(prefix, msg, data ?? ''),
    warn: (msg, data) => console.warn(prefix, msg, data ?? ''),
    error: (msg, data) => console.error(prefix, msg, data ?? ''),
  };
}

/**
 * Workflow engine. Chains steps together and runs work items through them.
 */
export class Workflow {
  private steps: Step[] = [];
  private store: WorkflowStore;
  private resources: Record<string, unknown> = {};
  private id: string;

  constructor(options?: { id?: string; store?: WorkflowStore; baseDir?: string }) {
    this.id = options?.id ?? generateId();
    this.store = options?.store ?? new FileStore(options?.baseDir);
  }

  /** Register a shared resource (e.g. AI client, SERP client). */
  resource(name: string, value: unknown): this {
    this.resources[name] = value;
    return this;
  }

  /** Add a step to the pipeline. */
  step(step: Step): this {
    this.steps.push(step);
    return this;
  }

  /** Run a single item through the full pipeline (useful for testing). */
  async runOne<T>(item: WorkItem<T>, options?: WorkflowOptions): Promise<ItemState> {
    const results = await this.run([item], { ...options, concurrency: 1 });
    return results[0];
  }

  /** Run all items through the pipeline. */
  async run<T>(items: WorkItem<T>[], options: WorkflowOptions = {}): Promise<ItemState[]> {
    const concurrency = options.concurrency ?? 5;
    const maxRetries = options.maxRetries ?? 2;
    const signal = options.signal ?? new AbortController().signal;

    // Initialize item states
    const states: Map<string, ItemState> = new Map();
    for (const item of items) {
      const existing = await this.store.getItem(this.id, item.id);
      if (existing && existing.status === 'completed') {
        states.set(item.id, existing);
        continue;
      }

      const state: ItemState = existing ?? {
        id: item.id,
        currentStep: this.steps[0]?.name ?? '',
        status: 'pending',
        stepOutputs: {},
        attempts: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Store the initial data as step input
      await this.store.saveStepOutput(this.id, item.id, '_input', item.data);
      states.set(item.id, state);
    }

    // Process steps in order
    for (const step of this.steps) {
      if (signal.aborted) break;

      const pendingItems = [...states.values()].filter(
        s => s.status !== 'completed' || this.getStepIndex(s.currentStep) <= this.getStepIndex(step.name)
      ).filter(s => s.status !== 'failed');

      // Skip if no items need this step
      const needsProcessing = [];
      for (const item of pendingItems) {
        const cached = await this.store.getStepOutput(this.id, item.id, step.name);
        if (cached !== null) {
          item.stepOutputs[step.name] = cached;
          item.currentStep = this.getNextStepName(step.name);
          item.updatedAt = new Date().toISOString();
          await this.store.saveItem(this.id, item);
          continue;
        }
        needsProcessing.push(item);
      }

      if (needsProcessing.length === 0) continue;

      if (step.mode === 'collective') {
        await this.runCollectiveStep(step, needsProcessing, states, maxRetries, signal);
      } else {
        await this.runConcurrentStep(step, needsProcessing, states, concurrency, maxRetries, signal, options.onProgress);
      }
    }

    // Mark completed items
    for (const state of states.values()) {
      if (state.status !== 'failed') {
        state.status = 'completed';
        state.updatedAt = new Date().toISOString();
        await this.store.saveItem(this.id, state);
      }
    }

    return [...states.values()];
  }

  private async runConcurrentStep(
    step: Step,
    items: ItemState[],
    states: Map<string, ItemState>,
    concurrency: number,
    maxRetries: number,
    signal: AbortSignal,
    onProgress?: (p: WorkflowProgress) => void,
  ): Promise<void> {
    const active = new Set<Promise<void>>();
    let completed = 0;
    let failed = 0;

    const processItem = async (item: ItemState): Promise<void> => {
      if (signal.aborted) return;

      const prevStepName = this.getPrevStepName(step.name);
      const input = prevStepName
        ? await this.store.getStepOutput(this.id, item.id, prevStepName)
        : await this.store.getStepOutput(this.id, item.id, '_input');

      const ctx: StepContext = {
        itemId: item.id,
        resources: this.resources,
        log: createLogger(item.id, step.name),
        getCache: (name) => this.store.getStepOutput(this.id, item.id, name),
        signal,
      };

      item.currentStep = step.name;
      item.status = 'running';
      item.updatedAt = new Date().toISOString();
      await this.store.saveItem(this.id, item);

      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          item.attempts = attempt + 1;
          const output = await step.run(input, ctx);
          await this.store.saveStepOutput(this.id, item.id, step.name, output);
          item.stepOutputs[step.name] = output;
          item.currentStep = this.getNextStepName(step.name);
          item.status = 'pending';
          item.updatedAt = new Date().toISOString();
          await this.store.saveItem(this.id, item);
          completed++;
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            ctx.log.warn(`Attempt ${attempt + 1} failed, retrying...`, { error: lastError.message });
            await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
          }
        }
      }

      item.status = 'failed';
      item.error = lastError?.message;
      item.updatedAt = new Date().toISOString();
      await this.store.saveItem(this.id, item);
      failed++;
    };

    for (const item of items) {
      if (signal.aborted) break;

      if (active.size >= concurrency) {
        await Promise.race(active);
      }

      const promise = processItem(item).then(() => { active.delete(promise); });
      active.add(promise);

      if (onProgress) {
        onProgress({
          total: items.length,
          completed,
          failed,
          running: active.size,
          currentStep: step.name,
        });
      }
    }

    await Promise.all(active);
  }

  private async runCollectiveStep(
    step: Step,
    items: ItemState[],
    states: Map<string, ItemState>,
    maxRetries: number,
    signal: AbortSignal,
  ): Promise<void> {
    const prevStepName = this.getPrevStepName(step.name);
    const inputs: unknown[] = [];
    for (const item of items) {
      const input = prevStepName
        ? await this.store.getStepOutput(this.id, item.id, prevStepName)
        : await this.store.getStepOutput(this.id, item.id, '_input');
      inputs.push({ id: item.id, data: input });
    }

    const ctx: StepContext = {
      itemId: '_collective',
      resources: this.resources,
      log: createLogger('_collective', step.name),
      getCache: (name) => this.store.getStepOutput(this.id, '_collective', name),
      signal,
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const outputs = await step.run(inputs, ctx) as unknown[];

        // Save individual outputs if the step returns an array matching items
        if (Array.isArray(outputs) && outputs.length === items.length) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await this.store.saveStepOutput(this.id, item.id, step.name, outputs[i]);
            item.stepOutputs[step.name] = outputs[i];
            item.currentStep = this.getNextStepName(step.name);
            item.updatedAt = new Date().toISOString();
            await this.store.saveItem(this.id, item);
          }
        } else {
          // Collective output saved once
          await this.store.saveStepOutput(this.id, '_collective', step.name, outputs);
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          ctx.log.warn(`Attempt ${attempt + 1} failed, retrying...`);
          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
        }
      }
    }

    // Mark all items as failed
    for (const item of items) {
      item.status = 'failed';
      item.error = lastError?.message;
      item.updatedAt = new Date().toISOString();
      await this.store.saveItem(this.id, item);
    }
  }

  private getStepIndex(name: string): number {
    return this.steps.findIndex(s => s.name === name);
  }

  private getNextStepName(name: string): string {
    const idx = this.getStepIndex(name);
    return idx < this.steps.length - 1 ? this.steps[idx + 1].name : '_done';
  }

  private getPrevStepName(name: string): string | null {
    const idx = this.getStepIndex(name);
    return idx > 0 ? this.steps[idx - 1].name : null;
  }
}
