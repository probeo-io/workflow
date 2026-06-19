/**
 * A single step in a workflow pipeline.
 * Each step implements this interface — the engine chains them together.
 */
interface Step<TIn = unknown, TOut = unknown> {
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
interface StepContext {
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
interface Logger {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
}
/**
 * A work item flowing through the pipeline.
 */
interface WorkItem<T = unknown> {
    /** Unique identifier for this item. */
    id: string;
    /** The item's data — evolves as it passes through steps. */
    data: T;
}
/**
 * Tracks the state of a single item in the workflow.
 */
interface ItemState {
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
interface WorkflowStore {
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
interface WorkflowOptions {
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
interface WorkflowProgress {
    total: number;
    completed: number;
    failed: number;
    running: number;
    currentStep: string;
}

/**
 * Workflow engine. Chains steps together and runs work items through them.
 */
declare class Workflow {
    private steps;
    private store;
    private resources;
    private id;
    constructor(options?: {
        id?: string;
        store?: WorkflowStore;
        baseDir?: string;
    });
    /** Register a shared resource (e.g. AI client, SERP client). */
    resource(name: string, value: unknown): this;
    /** Add a step to the pipeline. */
    step(step: Step): this;
    /** Run a single item through the full pipeline (useful for testing). */
    runOne<T>(item: WorkItem<T>, options?: WorkflowOptions): Promise<ItemState>;
    /** Run all items through the pipeline. */
    run<T>(items: WorkItem<T>[], options?: WorkflowOptions): Promise<ItemState[]>;
    private runConcurrentStep;
    private runCollectiveStep;
    private getStepIndex;
    private getNextStepName;
    private getPrevStepName;
}

/**
 * Filesystem-based workflow store.
 * Structure:
 *   {baseDir}/{workflowId}/_state/{itemId}.json
 *   {baseDir}/{workflowId}/{stepName}/{itemId}.json
 *
 * This gives a step-first layout under each workflow id.
 * All writes are immutable for step outputs — written once.
 */
declare class FileStore implements WorkflowStore {
    private baseDir;
    constructor(baseDir?: string);
    private stateDir;
    private stepDir;
    private statePath;
    private stepPath;
    private ensureDir;
    saveItem(workflowId: string, item: ItemState): Promise<void>;
    getItem(workflowId: string, itemId: string): Promise<ItemState | null>;
    listItems(workflowId: string): Promise<ItemState[]>;
    saveStepOutput(workflowId: string, itemId: string, stepName: string, output: unknown): Promise<void>;
    getStepOutput(workflowId: string, itemId: string, stepName: string): Promise<unknown | null>;
}

declare const DEFAULT_WORKFLOW_RESOURCE_KEY = "workflow";
declare function setWorkflowResource<T>(workflow: Workflow, value: T, key?: string): Workflow;
declare function readWorkflowResource<T>(ctx: StepContext, key?: string): T;

export { DEFAULT_WORKFLOW_RESOURCE_KEY, FileStore, type ItemState, type Logger, type Step, type StepContext, type WorkItem, Workflow, type WorkflowOptions, type WorkflowProgress, type WorkflowStore, readWorkflowResource, setWorkflowResource };
