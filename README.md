# @probeo/workflow

Lightweight workflow engine with per-item concurrency and stage-based pipelines. Designed for multi-step data processing where each item flows through a series of steps independently.

## Install

```bash
npm install @probeo/workflow
```

## Concepts

- **Step** — a named unit of work with a `run()` function. Each step declares a `mode`:
  - `concurrent` — runs per-item, many in parallel (up to the concurrency limit)
  - `collective` — waits for all items, runs once with the full set
- **Workflow** — chains steps together and runs work items through them. Supports resource injection, progress callbacks, and abort signals.
- **FileStore** — filesystem-based persistence with immutable write-once step outputs. Enables resume after interruption.

## Usage

```typescript
import { Workflow } from "@probeo/workflow";
import type { Step } from "@probeo/workflow";

const fetchStep: Step<string, { title: string; body: string }> = {
  name: "fetch",
  mode: "concurrent",
  async run(url, ctx) {
    ctx.log.info(`Fetching ${url}`);
    const res = await fetch(url);
    const body = await res.text();
    return { title: url, body };
  },
};

const summarizeStep: Step = {
  name: "summarize",
  mode: "collective",
  async run(items, ctx) {
    const ai = ctx.resources.ai as any;
    return items.map((item: any) => ({
      id: item.id,
      summary: `Summary of ${item.data.title}`,
    }));
  },
};

const wf = new Workflow({ baseDir: ".workflow-data" })
  .resource("ai", myAiClient)
  .step(fetchStep)
  .step(summarizeStep);

const results = await wf.run(
  urls.map((url, i) => ({ id: `page-${i}`, data: url })),
  {
    concurrency: 10,
    maxRetries: 2,
    onProgress: (p) =>
      console.log(`${p.completed}/${p.total} (${p.currentStep})`),
  }
);
```

## API

### `new Workflow(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | auto-generated | Workflow run identifier |
| `store` | `WorkflowStore` | `FileStore` | Persistence backend |
| `baseDir` | `string` | `".workflow"` | Base directory for `FileStore` |

### `.resource(name, value)`

Register a shared resource (e.g. AI client, database connection) available to all steps via `ctx.resources`.

### `.step(step)`

Add a step to the pipeline. Steps run in the order they are added.

### `.run(items, options?)`

Run all items through the pipeline. Returns an array of `ItemState` objects.

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `5` | Max parallel items for concurrent steps |
| `maxRetries` | `number` | `2` | Retry attempts per item per step |
| `onProgress` | `function` | — | Progress callback |
| `signal` | `AbortSignal` | — | Cancellation signal |

### `.runOne(item, options?)`

Convenience method to run a single item. Returns one `ItemState`.

### `FileStore`

Filesystem-backed store. Step outputs are immutable — once written, they are never overwritten. This makes workflows safe to resume after interruption.

## License

MIT
