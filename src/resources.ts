import type { Workflow } from './engine.js';
import type { StepContext } from './types.js';

export const DEFAULT_WORKFLOW_RESOURCE_KEY = 'workflow';

export function setWorkflowResource<T>(
  workflow: Workflow,
  value: T,
  key: string = DEFAULT_WORKFLOW_RESOURCE_KEY,
): Workflow {
  return workflow.resource(key, value);
}

export function readWorkflowResource<T>(
  ctx: StepContext,
  key: string = DEFAULT_WORKFLOW_RESOURCE_KEY,
): T {
  const value = ctx.resources[key] as T | undefined;
  if (value === undefined || value === null) {
    throw new Error(`workflow.resources: missing required resource "${key}"`);
  }
  return value;
}
