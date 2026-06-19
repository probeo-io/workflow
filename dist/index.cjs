"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  DEFAULT_WORKFLOW_RESOURCE_KEY: () => DEFAULT_WORKFLOW_RESOURCE_KEY,
  FileStore: () => FileStore,
  Workflow: () => Workflow,
  readWorkflowResource: () => readWorkflowResource,
  setWorkflowResource: () => setWorkflowResource
});
module.exports = __toCommonJS(src_exports);

// src/store.ts
var import_promises = require("fs/promises");
var import_node_fs = require("fs");
var import_node_path = require("path");
var FileStore = class {
  baseDir;
  constructor(baseDir = ".workflow") {
    this.baseDir = baseDir;
  }
  stateDir(workflowId) {
    return (0, import_node_path.join)(this.baseDir, workflowId, "_state");
  }
  stepDir(workflowId, stepName) {
    return (0, import_node_path.join)(this.baseDir, workflowId, stepName);
  }
  statePath(workflowId, itemId) {
    return (0, import_node_path.join)(this.stateDir(workflowId), `${itemId}.json`);
  }
  stepPath(workflowId, stepName, itemId) {
    return (0, import_node_path.join)(this.stepDir(workflowId, stepName), `${itemId}.json`);
  }
  async ensureDir(dir) {
    if (!(0, import_node_fs.existsSync)(dir)) {
      await (0, import_promises.mkdir)(dir, { recursive: true });
    }
  }
  async saveItem(workflowId, item) {
    const dir = this.stateDir(workflowId);
    await this.ensureDir(dir);
    await (0, import_promises.writeFile)(this.statePath(workflowId, item.id), JSON.stringify(item, null, 2));
  }
  async getItem(workflowId, itemId) {
    const path = this.statePath(workflowId, itemId);
    if (!(0, import_node_fs.existsSync)(path)) return null;
    const raw = await (0, import_promises.readFile)(path, "utf8");
    return JSON.parse(raw);
  }
  async listItems(workflowId) {
    const dir = this.stateDir(workflowId);
    if (!(0, import_node_fs.existsSync)(dir)) return [];
    const entries = await (0, import_promises.readdir)(dir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const itemId = entry.name.slice(0, -5);
      const item = await this.getItem(workflowId, itemId);
      if (item) items.push(item);
    }
    return items;
  }
  async saveStepOutput(workflowId, itemId, stepName, output) {
    const dir = this.stepDir(workflowId, stepName);
    await this.ensureDir(dir);
    const path = this.stepPath(workflowId, stepName, itemId);
    if ((0, import_node_fs.existsSync)(path)) return;
    await (0, import_promises.writeFile)(path, JSON.stringify(output, null, 2));
  }
  async getStepOutput(workflowId, itemId, stepName) {
    const path = this.stepPath(workflowId, stepName, itemId);
    if (!(0, import_node_fs.existsSync)(path)) return null;
    const raw = await (0, import_promises.readFile)(path, "utf8");
    return JSON.parse(raw);
  }
};

// src/engine.ts
function generateId(prefix = "wf") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function createLogger(itemId, stepName) {
  const prefix = `[${itemId}:${stepName}]`;
  return {
    info: (msg, data) => console.log(prefix, msg, data ?? ""),
    warn: (msg, data) => console.warn(prefix, msg, data ?? ""),
    error: (msg, data) => console.error(prefix, msg, data ?? "")
  };
}
var Workflow = class {
  steps = [];
  store;
  resources = {};
  id;
  constructor(options) {
    this.id = options?.id ?? generateId();
    this.store = options?.store ?? new FileStore(options?.baseDir);
  }
  /** Register a shared resource (e.g. AI client, SERP client). */
  resource(name, value) {
    this.resources[name] = value;
    return this;
  }
  /** Add a step to the pipeline. */
  step(step) {
    this.steps.push(step);
    return this;
  }
  /** Run a single item through the full pipeline (useful for testing). */
  async runOne(item, options) {
    const results = await this.run([item], { ...options, concurrency: 1 });
    return results[0];
  }
  /** Run all items through the pipeline. */
  async run(items, options = {}) {
    const concurrency = options.concurrency ?? 5;
    const maxRetries = options.maxRetries ?? 2;
    const signal = options.signal ?? new AbortController().signal;
    const states = /* @__PURE__ */ new Map();
    for (const item of items) {
      const existing = await this.store.getItem(this.id, item.id);
      if (existing && existing.status === "completed") {
        states.set(item.id, existing);
        continue;
      }
      const state = existing ?? {
        id: item.id,
        currentStep: this.steps[0]?.name ?? "",
        status: "pending",
        stepOutputs: {},
        attempts: 0,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.store.saveStepOutput(this.id, item.id, "_input", item.data);
      states.set(item.id, state);
    }
    for (const step of this.steps) {
      if (signal.aborted) break;
      const pendingItems = [...states.values()].filter(
        (s) => s.status !== "completed" || this.getStepIndex(s.currentStep) <= this.getStepIndex(step.name)
      ).filter((s) => s.status !== "failed");
      const needsProcessing = [];
      for (const item of pendingItems) {
        const cached = await this.store.getStepOutput(this.id, item.id, step.name);
        if (cached !== null) {
          item.stepOutputs[step.name] = cached;
          item.currentStep = this.getNextStepName(step.name);
          item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          await this.store.saveItem(this.id, item);
          continue;
        }
        needsProcessing.push(item);
      }
      if (needsProcessing.length === 0) continue;
      if (step.mode === "collective") {
        await this.runCollectiveStep(step, needsProcessing, states, maxRetries, signal);
      } else {
        await this.runConcurrentStep(step, needsProcessing, states, concurrency, maxRetries, signal, options.onProgress);
      }
    }
    for (const state of states.values()) {
      if (state.status !== "failed") {
        state.status = "completed";
        state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        await this.store.saveItem(this.id, state);
      }
    }
    return [...states.values()];
  }
  async runConcurrentStep(step, items, states, concurrency, maxRetries, signal, onProgress) {
    const active = /* @__PURE__ */ new Set();
    let completed = 0;
    let failed = 0;
    const processItem = async (item) => {
      if (signal.aborted) return;
      const prevStepName = this.getPrevStepName(step.name);
      const input = prevStepName ? await this.store.getStepOutput(this.id, item.id, prevStepName) : await this.store.getStepOutput(this.id, item.id, "_input");
      const ctx = {
        itemId: item.id,
        resources: this.resources,
        log: createLogger(item.id, step.name),
        getCache: (name) => this.store.getStepOutput(this.id, item.id, name),
        signal
      };
      item.currentStep = step.name;
      item.status = "running";
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await this.store.saveItem(this.id, item);
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          item.attempts = attempt + 1;
          const output = await step.run(input, ctx);
          await this.store.saveStepOutput(this.id, item.id, step.name, output);
          item.stepOutputs[step.name] = output;
          item.currentStep = this.getNextStepName(step.name);
          item.status = "pending";
          item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          await this.store.saveItem(this.id, item);
          completed++;
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            ctx.log.warn(`Attempt ${attempt + 1} failed, retrying...`, { error: lastError.stack ?? lastError.message });
            await new Promise((r) => setTimeout(r, Math.min(1e3 * Math.pow(2, attempt), 1e4)));
          } else {
            ctx.log.warn(`All attempts failed`, { error: lastError.stack ?? lastError.message });
          }
        }
      }
      item.status = "failed";
      item.error = lastError?.message;
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await this.store.saveItem(this.id, item);
      failed++;
    };
    for (const item of items) {
      if (signal.aborted) break;
      if (active.size >= concurrency) {
        await Promise.race(active);
      }
      const promise = processItem(item).then(() => {
        active.delete(promise);
      });
      active.add(promise);
      if (onProgress) {
        onProgress({
          total: items.length,
          completed,
          failed,
          running: active.size,
          currentStep: step.name
        });
      }
    }
    await Promise.all(active);
  }
  async runCollectiveStep(step, items, states, maxRetries, signal) {
    const prevStepName = this.getPrevStepName(step.name);
    const inputs = [];
    for (const item of items) {
      const input = prevStepName ? await this.store.getStepOutput(this.id, item.id, prevStepName) : await this.store.getStepOutput(this.id, item.id, "_input");
      inputs.push({ id: item.id, data: input });
    }
    const ctx = {
      itemId: "_collective",
      resources: this.resources,
      log: createLogger("_collective", step.name),
      getCache: (name) => this.store.getStepOutput(this.id, "_collective", name),
      signal
    };
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const outputs = await step.run(inputs, ctx);
        if (Array.isArray(outputs) && outputs.length === items.length) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await this.store.saveStepOutput(this.id, item.id, step.name, outputs[i]);
            item.stepOutputs[step.name] = outputs[i];
            item.currentStep = this.getNextStepName(step.name);
            item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
            await this.store.saveItem(this.id, item);
          }
        } else {
          await this.store.saveStepOutput(this.id, "_collective", step.name, outputs);
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          ctx.log.warn(`Attempt ${attempt + 1} failed, retrying...`);
          await new Promise((r) => setTimeout(r, Math.min(1e3 * Math.pow(2, attempt), 1e4)));
        }
      }
    }
    for (const item of items) {
      item.status = "failed";
      item.error = lastError?.message;
      item.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await this.store.saveItem(this.id, item);
    }
  }
  getStepIndex(name) {
    return this.steps.findIndex((s) => s.name === name);
  }
  getNextStepName(name) {
    const idx = this.getStepIndex(name);
    return idx < this.steps.length - 1 ? this.steps[idx + 1].name : "_done";
  }
  getPrevStepName(name) {
    const idx = this.getStepIndex(name);
    return idx > 0 ? this.steps[idx - 1].name : null;
  }
};

// src/resources.ts
var DEFAULT_WORKFLOW_RESOURCE_KEY = "workflow";
function setWorkflowResource(workflow, value, key = DEFAULT_WORKFLOW_RESOURCE_KEY) {
  return workflow.resource(key, value);
}
function readWorkflowResource(ctx, key = DEFAULT_WORKFLOW_RESOURCE_KEY) {
  const value = ctx.resources[key];
  if (value === void 0 || value === null) {
    throw new Error(`workflow.resources: missing required resource "${key}"`);
  }
  return value;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_WORKFLOW_RESOURCE_KEY,
  FileStore,
  Workflow,
  readWorkflowResource,
  setWorkflowResource
});
//# sourceMappingURL=index.cjs.map