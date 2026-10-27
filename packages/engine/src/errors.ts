import type { NodeStatus } from "./types.js";

export class FlowForgeError extends Error {
  readonly code: string;
  readonly nodeId?: string;
  readonly stage?: string;
  readonly pointer?: string;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    options: { nodeId?: string; stage?: string; pointer?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "FlowForgeError";
    this.code = code;
    this.nodeId = options.nodeId;
    this.stage = options.stage;
    this.pointer = options.pointer;
    this.details = options.details;
  }

  toPayload(): {
    code: string;
    message: string;
    nodeId?: string;
    stage?: string;
    pointer?: string;
    details?: unknown;
  } {
    return {
      code: this.code,
      message: this.message,
      nodeId: this.nodeId,
      stage: this.stage,
      pointer: this.pointer,
      details: this.details,
    };
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.name === "AbortError" || (error as Error & { code?: string }).code === "ABORT_ERR")) ||
    (error instanceof FlowForgeError && error.code === "RUN_CANCELED")
  );
}

export function toErrorPayload(error: unknown, nodeId?: string): {
  code: string;
  message: string;
  nodeId?: string;
  stage?: string;
  pointer?: string;
  details?: unknown;
} {
  if (error instanceof FlowForgeError) {
    return error.toPayload();
  }
  if (error instanceof Error) {
    const code =
      (error as Error & { code?: string }).code ??
      (error.name === "TimeoutError" ? "WAIT_TIMEOUT" : "ENGINE_ERROR");
    return { code, message: error.message, nodeId };
  }
  return { code: "ENGINE_ERROR", message: String(error), nodeId };
}

export function statusForError(error: unknown): NodeStatus {
  if (isAbortError(error)) return "fail";
  return "fail";
}

export const ERROR_CODES = {
  compileFailed: "COMPILE_FAILED",
  readinessTooLow: "READINESS_TOO_LOW",
  dataUnresolved: "DATA_UNRESOLVED",
  constraintFailed: "CONSTRAINT_FAILED",
  constraintCycle: "CONSTRAINT_CYCLE",
  targetNotFound: "TARGET_NOT_FOUND",
  targetAmbiguous: "TARGET_AMBIGUOUS",
  pickNoMatch: "PICK_NO_MATCH",
  pickAmbiguous: "PICK_AMBIGUOUS",
  filterNoResult: "FILTER_NO_RESULT",
  commitTimeout: "COMMIT_TIMEOUT",
  backfillMismatch: "BACKFILL_MISMATCH",
  waitTimeout: "WAIT_TIMEOUT",
  assertionFailed: "ASSERTION_FAILED",
  actionFailed: "ACTION_FAILED",
  readBackMismatch: "READBACK_MISMATCH",
  branchEvalFailed: "BRANCH_EVAL_FAILED",
  apiFailed: "API_FAILED",
  apiCrossOrigin: "API_CROSS_ORIGIN",
  browserLaunch: "BROWSER_LAUNCH_FAILED",
  navigationFailed: "NAVIGATION_FAILED",
  runCanceled: "RUN_CANCELED",
  duplicateExhausted: "DUPLICATE_EXHAUSTED",
  notReached: "NOT_REACHED",
  contextLost: "CONTEXT_LOST",
} as const;
