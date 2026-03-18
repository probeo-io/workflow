/**
 * A single step in a workflow pipeline.
 * Each step implements this interface — the engine chains them together.
 */
export interface Step<TIn = unknown, TOut = unknown> {
  /** Unique name for this step. Used for caching/persistence keys. */
  name: string;

  /**
   * "concurrent" — runs per-item, many in parallel.
   * "collective" — waits for all items, runs once with the full set.
   */
  mode: 'concurrent' | 'collective';

  /**
   * Execute the step.
   * - concurrent mode: called once per item with a single input.
   * - collective mode: called once with all inputs as an array.
   */
  run(input: TIn, ctx: StepContext): Promise<TOut>;
}

/**
 * Context passed to each step. Provides access to shared resources
 * and utilities without the step needing to know about the engine.
 */
export interface StepContext {
  /** Unique ID for this work item. */
  itemId: string;

  /** Workflow-level shared resources (e.g. AI client, SERP client). */
  resources: Record<string, unknown>;

  /** Logger scoped to this item + step. */
  log: Logger;

  /** Read a previously cached step output for this item. */
  getCache(stepName: string): Promise<unknown | null>;

  /** Signal for cancellation. */
  signal: AbortSignal;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * A work item flowing through the pipeline.
 */
export interface WorkItem<T = unknown> {
  /** Unique identifier for this item. */
  id: string;

  /** The item's data — evolves as it passes through steps. */
  data: T;
}

/**
 * Tracks the state of a single item in the workflow.
 */
export interface ItemState {
  id: string;
  currentStep: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  stepOutputs: Record<string, unknown>;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Storage interface for persisting workflow state.
 * Default implementation uses the filesystem.
 */
export interface WorkflowStore {
  /** Save item state. */
  saveItem(workflowId: string, item: ItemState): Promise<void>;

  /** Load item state. */
  getItem(workflowId: string, itemId: string): Promise<ItemState | null>;

  /** List all items in a workflow. */
  listItems(workflowId: string): Promise<ItemState[]>;

  /** Save a step's output for an item. Immutable — written once. */
  saveStepOutput(workflowId: string, itemId: string, stepName: string, output: unknown): Promise<void>;

  /** Load a step's output for an item. */
  getStepOutput(workflowId: string, itemId: string, stepName: string): Promise<unknown | null>;
}

/**
 * Options for running a workflow.
 */
export interface WorkflowOptions {
  /** Max concurrent items for concurrent steps. Default: 5. */
  concurrency?: number;

  /** Max retries per item per step. Default: 2. */
  maxRetries?: number;

  /** Progress callback. */
  onProgress?: (progress: WorkflowProgress) => void;

  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Progress report emitted during workflow execution.
 */
export interface WorkflowProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  currentStep: string;
}
