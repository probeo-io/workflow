/**
 * Basic usage examples for @probeo/workflow
 *
 * Run with:
 *   npx tsx examples/basic.ts
 */

import { Workflow } from "../src/index.js";
import type { Step } from "../src/index.js";

// ── Simple two-step pipeline ─────────────────────────────────────────────────

async function simplePipeline() {
  console.log("=== Simple Pipeline ===\n");

  const uppercase: Step<string, string> = {
    name: "uppercase",
    mode: "concurrent",
    async run(input) {
      return input.toUpperCase();
    },
  };

  const addPrefix: Step<string, string> = {
    name: "add-prefix",
    mode: "concurrent",
    async run(input) {
      return `PROCESSED: ${input}`;
    },
  };

  const results = await new Workflow({ baseDir: ".example-pipeline" })
    .step(uppercase)
    .step(addPrefix)
    .run([
      { id: "item-1", data: "hello world" },
      { id: "item-2", data: "foo bar" },
      { id: "item-3", data: "pipeline test" },
    ]);

  for (const r of results) {
    console.log(`  ${r.id}: ${r.outputs["add-prefix"]}`);
  }
  console.log();
}

// ── Pipeline with shared resources ───────────────────────────────────────────

async function withResources() {
  console.log("=== Shared Resources ===\n");

  const config = { prefix: "v2", separator: "-" };

  const tag: Step<string, string> = {
    name: "tag",
    mode: "concurrent",
    async run(input, ctx) {
      const cfg = ctx.resources.config as typeof config;
      return `${cfg.prefix}${cfg.separator}${input}`;
    },
  };

  const results = await new Workflow({ baseDir: ".example-resources" })
    .resource("config", config)
    .step(tag)
    .run([
      { id: "a", data: "alpha" },
      { id: "b", data: "beta" },
    ]);

  for (const r of results) {
    console.log(`  ${r.id}: ${r.outputs["tag"]}`);
  }
  console.log();
}

// ── Collective step (aggregation) ────────────────────────────────────────────

async function collectiveStep() {
  console.log("=== Collective Step ===\n");

  const score: Step<string, number> = {
    name: "score",
    mode: "concurrent",
    async run(input) {
      return input.length;
    },
  };

  const summarize: Step = {
    name: "summarize",
    mode: "collective",
    async run(items) {
      const total = items.reduce((sum: number, i: any) => sum + i.data, 0);
      const avg = total / items.length;
      return items.map((i: any) => ({
        id: i.id,
        summary: `Score: ${i.data}, Average: ${avg.toFixed(1)}`,
      }));
    },
  };

  const results = await new Workflow({ baseDir: ".example-collective" })
    .step(score)
    .step(summarize)
    .run([
      { id: "short", data: "hi" },
      { id: "medium", data: "hello world" },
      { id: "long", data: "this is a longer string for testing" },
    ]);

  for (const r of results) {
    console.log(`  ${r.id}: ${r.outputs["summarize"]}`);
  }
  console.log();
}

// ── Progress tracking ────────────────────────────────────────────────────────

async function progressTracking() {
  console.log("=== Progress Tracking ===\n");

  const slow: Step<number, string> = {
    name: "process",
    mode: "concurrent",
    async run(input) {
      await new Promise(r => setTimeout(r, input * 100));
      return `done in ${input * 100}ms`;
    },
  };

  const results = await new Workflow({ baseDir: ".example-progress" })
    .step(slow)
    .run(
      [
        { id: "fast", data: 1 },
        { id: "medium", data: 3 },
        { id: "slow", data: 5 },
      ],
      {
        concurrency: 2,
        onProgress: (p) => console.log(`  Progress: ${p.completed}/${p.total} (${p.currentStep})`),
      },
    );

  console.log();
  for (const r of results) {
    console.log(`  ${r.id}: ${r.outputs["process"]}`);
  }
  console.log();
}

// ── Run examples ─────────────────────────────────────────────────────────────

async function main() {
  const example = process.argv[2];

  const examples: Record<string, () => Promise<void>> = {
    simple: simplePipeline,
    resources: withResources,
    collective: collectiveStep,
    progress: progressTracking,
  };

  if (example && examples[example]) {
    await examples[example]();
  } else if (!example) {
    for (const [name, fn] of Object.entries(examples)) {
      try {
        await fn();
      } catch (err: any) {
        console.log(`[${name}] Skipped: ${err.message}\n`);
      }
    }
  } else {
    console.log(`Unknown example: ${example}`);
    console.log(`Available: ${Object.keys(examples).join(", ")}`);
  }
}

main().catch(console.error);
