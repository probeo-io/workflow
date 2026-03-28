# @probeo/workflow

Stage-based pipeline engine for AI workloads. Zero dependencies. Code decides what happens. AI does the work.

Most AI pipelines are linear: fetch data, analyze it, enrich it, summarize it. Some stages call LLMs. Some don't. The control flow is deterministic even when AI is involved. You don't need a graph framework for that.

@probeo/workflow gives you per-item concurrency, retry with backoff, filesystem persistence, and resume-after-crash. No graph theory. No 53 MB dependency tree. No framework lock-in.

## Install

```bash
npm install @probeo/workflow
```

## Quick Start

```typescript
import { Workflow } from "@probeo/workflow";
import type { Step } from "@probeo/workflow";

const analyze: Step<string, { title: string; summary: string }> = {
  name: "analyze",
  mode: "concurrent",
  async run(url, ctx) {
    const res = await fetch(url);
    const html = await res.text();
    const ai = ctx.resources.ai as AnyModel;
    const summary = await ai.chat({
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [{ role: "user", content: `Summarize this page:\n\n${html.slice(0, 5000)}` }],
    });
    return { title: url, summary: summary.message.content };
  },
};

const results = await new Workflow({ baseDir: ".pipeline" })
  .resource("ai", new AnyModel({ apiKey: process.env.OPENROUTER_KEY }))
  .step(analyze)
  .run(urls.map((url, i) => ({ id: `page-${i}`, data: url })), {
    concurrency: 10,
    maxRetries: 2,
  });
```

## Use Cases

### Content pipeline with AnyModel

Crawl pages, extract content with an LLM, generate SEO metadata. Each stage is a step. LLM calls happen inside steps, not as routing decisions.

```typescript
import { Workflow } from "@probeo/workflow";
import { AnyModel } from "@probeo/anymodel";
import type { Step } from "@probeo/workflow";

const crawl: Step<string, { url: string; html: string }> = {
  name: "crawl",
  mode: "concurrent",
  async run(url, ctx) {
    const res = await fetch(url);
    return { url, html: await res.text() };
  },
};

const extract: Step = {
  name: "extract",
  mode: "concurrent",
  async run(page, ctx) {
    const ai = ctx.resources.ai as AnyModel;
    const result = await ai.chat({
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: `Extract the main content from this HTML. Return JSON with title, description, and bodyText.\n\n${page.html.slice(0, 8000)}`,
      }],
    });
    return { ...page, content: JSON.parse(result.message.content) };
  },
};

const generateMeta: Step = {
  name: "generate-meta",
  mode: "concurrent",
  async run(page, ctx) {
    const ai = ctx.resources.ai as AnyModel;
    const result = await ai.chat({
      model: "openai/gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Write an SEO meta description (under 160 chars) for this content:\n\nTitle: ${page.content.title}\n\n${page.content.bodyText.slice(0, 2000)}`,
      }],
    });
    return { ...page, meta: result.message.content };
  },
};

const pipeline = new Workflow({ baseDir: ".content-pipeline" })
  .resource("ai", new AnyModel({ apiKey: process.env.OPENROUTER_KEY }))
  .step(crawl)
  .step(extract)
  .step(generateMeta);

const results = await pipeline.run(
  urls.map((url, i) => ({ id: `page-${i}`, data: url })),
  {
    concurrency: 5,
    maxRetries: 2,
    onProgress: (p) => console.log(`${p.completed}/${p.total} (${p.currentStep})`),
  }
);
```

### Research pipeline with AnySerp + AnyModel

Search the web for a topic, fetch the top results, analyze them with an LLM, then produce a collective summary.

```typescript
import { Workflow } from "@probeo/workflow";
import { AnyModel } from "@probeo/anymodel";
import { AnySerp } from "@probeo/anyserp";
import type { Step } from "@probeo/workflow";

const search: Step<string, { query: string; results: any[] }> = {
  name: "search",
  mode: "concurrent",
  async run(query, ctx) {
    const serp = ctx.resources.serp as AnySerp;
    const results = await serp.search({ query, num: 5 });
    return { query, results: results.organic };
  },
};

const analyze: Step = {
  name: "analyze",
  mode: "concurrent",
  async run(data, ctx) {
    const ai = ctx.resources.ai as AnyModel;
    const snippets = data.results.map((r: any) => `${r.title}: ${r.snippet}`).join("\n");
    const result = await ai.chat({
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: `Analyze these search results for "${data.query}". What are the key themes and findings?\n\n${snippets}`,
      }],
    });
    return { ...data, analysis: result.message.content };
  },
};

const summarize: Step = {
  name: "summarize",
  mode: "collective",
  async run(items, ctx) {
    const ai = ctx.resources.ai as AnyModel;
    const analyses = items.map((i: any) => `## ${i.data.query}\n${i.data.analysis}`).join("\n\n");
    const result = await ai.chat({
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [{
        role: "user",
        content: `Synthesize these research analyses into a single brief:\n\n${analyses}`,
      }],
    });
    return items.map((i: any) => ({ id: i.id, summary: result.message.content }));
  },
};

const pipeline = new Workflow({ baseDir: ".research" })
  .resource("ai", new AnyModel({ apiKey: process.env.OPENROUTER_KEY }))
  .resource("serp", new AnySerp({ provider: "serper", apiKey: process.env.SERPER_KEY }))
  .step(search)
  .step(analyze)
  .step(summarize);

const results = await pipeline.run(
  queries.map((q, i) => ({ id: `query-${i}`, data: q })),
  { concurrency: 3 }
);
```

### Batch processing with resume

Process 10,000 items. If it crashes at item 6,000, restart and it picks up where it left off. FileStore writes are immutable. Completed steps are never re-run.

```typescript
const pipeline = new Workflow({
  id: "batch-2026-03-28",  // Fixed ID enables resume
  baseDir: ".batch-data",
})
  .step(fetchStep)
  .step(transformStep)
  .step(enrichStep);

// First run: processes all 10,000
await pipeline.run(items, { concurrency: 20 });

// Crashes at item 6,000. Restart:
// Items 1-6,000 are skipped (outputs exist on disk).
// Items 6,001-10,000 are processed.
await pipeline.run(items, { concurrency: 20 });
```

## Concepts

- **Step** -- a named unit of work with a `run()` function. Each step declares a `mode`:
  - `concurrent` -- runs per-item, many in parallel (up to the concurrency limit)
  - `collective` -- waits for all items, runs once with the full set (useful for summarization, aggregation)
- **Workflow** -- chains steps together. Supports resource injection, progress callbacks, and abort signals.
- **FileStore** -- filesystem persistence with immutable write-once outputs. Enables resume after crash.

## API

### `new Workflow(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | auto-generated | Workflow run identifier. Use a fixed ID to enable resume. |
| `store` | `WorkflowStore` | `FileStore` | Persistence backend |
| `baseDir` | `string` | `".workflow"` | Base directory for `FileStore` |

### `.resource(name, value)`

Register a shared resource available to all steps via `ctx.resources`.

### `.step(step)`

Add a step to the pipeline. Steps run in the order they are added.

### `.run(items, options?)`

Run all items through the pipeline. Returns an array of `ItemState` objects.

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `5` | Max parallel items for concurrent steps |
| `maxRetries` | `number` | `2` | Retry attempts per item per step (exponential backoff) |
| `onProgress` | `function` | -- | Progress callback |
| `signal` | `AbortSignal` | -- | Cancellation signal |

### `.runOne(item, options?)`

Run a single item through the full pipeline. Returns one `ItemState`.

### `FileStore`

Filesystem-backed store. Step outputs are immutable. Once written, never overwritten. Safe to resume after interruption.

### `StepContext`

Every step receives a context object:

| Property | Type | Description |
|---|---|---|
| `itemId` | `string` | Current item's ID |
| `resources` | `Record<string, unknown>` | Shared resources registered via `.resource()` |
| `log` | `Logger` | Logger scoped to this item + step |
| `getCache` | `(stepName) => Promise` | Read a previous step's cached output |
| `signal` | `AbortSignal` | Cancellation signal |

## Why not LangGraph?

LangGraph is for agent orchestration. Cyclic graphs where an LLM decides what to do next. That's the right tool when you need non-deterministic routing.

But most AI workloads are pipelines. Items flow through stages. Some stages call LLMs. The control flow is deterministic. For that, LangGraph adds complexity without value:

| | @probeo/workflow | LangGraph |
|---|---|---|
| Dependencies | 0 | 23 packages, 53 MB |
| Mental model | Steps in order | Nodes, edges, state reducers, graphs |
| Concurrency | Per-item with limits | Fan-out via Send pattern |
| Persistence | FileStore (filesystem) | Checkpointer (Postgres, memory) |
| Resume | Immutable step outputs | Checkpoint after every node |
| Lock-in | None | Requires @langchain/core (12 MB) |

## See Also

| Package | Description |
|---|---|
| [workflow-py](https://github.com/probeo-io/workflow-py) | Python version of this package |
| [workflow-go](https://github.com/probeo-io/workflow-go) | Go version of this package |
| [@probeo/anymodel](https://github.com/probeo-io/anymodel) | Unified LLM router for TypeScript |
| [@probeo/anyserp](https://github.com/probeo-io/anyserp) | Unified SERP API router for TypeScript |

## License

MIT
