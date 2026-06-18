import type { Registry } from "./registry";
import type { ServiceState } from "./types";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PREFIX = "[registry]";

/**
 * Walk the .cause chain and build a single string with all unique messages,
 * then append the deepest available stack trace.
 */
function formatError(error: Error): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    if (!parts.some((p) => p.includes(current instanceof Error ? current.message : ""))) {
      parts.push(current.message);
    }
    current = current.cause;
  }

  const fullMessage = parts.length === 1 ? parts[0]! : parts.join(" — caused by: ");

  // Prefer the deepest stack in the chain (closest to the actual throw site)
  let deepestStack: string | undefined;
  let cursor: unknown = error;
  while (cursor instanceof Error) {
    if (cursor.stack) deepestStack = cursor.stack;
    cursor = cursor.cause;
  }

  if (deepestStack) {
    // Replace the first line of the stack (which repeats the message) with our
    // full cause-chain message so the log line is self-contained.
    const stackBody = deepestStack.includes("\n")
      ? deepestStack.slice(deepestStack.indexOf("\n"))
      : "";
    return `${fullMessage}${stackBody}`;
  }

  return fullMessage;
}

/**
 * Subscribes to all registry lifetime events and logs them to the console.
 * Call this after creating the registry to observe service/tool lifecycle in the server.
 */
export function attachRegistryLogger(registry: Registry): void {
  registry.events.on("serviceStateChange", (serviceId, from, to) => {
    console.log(`${PREFIX} serviceStateChange ${serviceId}: ${from} → ${to}`);
  });

  registry.events.on("serviceError", (serviceId, error) => {
    console.error(`${PREFIX} serviceError ${serviceId}:\n${formatError(error)}`);
  });

  registry.events.on("serviceRegistered", (serviceId) => {
    console.log(`${PREFIX} serviceRegistered ${serviceId}`);
  });

  registry.events.on("toolRegistered", (toolId) => {
    console.log(`${PREFIX} toolRegistered ${toolId}`);
  });

  registry.events.on("toolInvoked", (toolId) => {
    console.log(`${PREFIX} toolInvoked ${toolId}`);
  });

  registry.events.on("toolCompleted", (toolId, durationMs) => {
    console.log(`${PREFIX} toolCompleted ${toolId} (${durationMs.toFixed(2)}ms)`);
  });

  registry.events.on("toolFailed", (toolId, error) => {
    console.error(`${PREFIX} toolFailed ${toolId}:\n${formatError(error)}`);
  });
}

export interface RegistryEventLogHandle {
  filePath: string;
  dispose: () => void;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

function errorToJson(error: Error): JsonValue {
  const cause = error.cause instanceof Error ? errorToJson(error.cause) : undefined;
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(cause ? { cause } : {}),
  };
}

/**
 * Persist registry lifecycle events as JSONL for downstream UIs and session
 * uploaders. This intentionally sits next to the human-readable logger rather
 * than replacing it: each line is a stable, machine-readable event envelope.
 */
export function attachRegistryEventLogger(
  registry: Registry,
  filePath: string
): RegistryEventLogHandle {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");

  let buffer: string[] = [];

  function flush(): void {
    if (buffer.length === 0) return;
    const pending = buffer;
    buffer = [];
    appendFileSync(filePath, pending.join(""));
  }

  function write(type: string, data: Record<string, JsonValue | undefined>): void {
    const event = {
      ts: new Date().toISOString(),
      type,
      ...data,
    };
    buffer.push(JSON.stringify(event) + "\n");
  }

  const onServiceStateChange = (serviceId: string, from: ServiceState, to: ServiceState): void => {
    write("service.state_change", { serviceId, from, to });
  };

  const onServiceError = (serviceId: string, error: Error): void => {
    write("service.error", { serviceId, error: errorToJson(error) });
  };

  const onServiceRegistered = (serviceId: string): void => {
    write("service.registered", { serviceId });
  };

  const onToolRegistered = (toolId: string): void => {
    write("tool.registered", { toolId });
  };

  const onToolInvoked = (toolId: string): void => {
    write("tool.invoked", { toolId });
  };

  const onToolCompleted = (toolId: string, durationMs: number): void => {
    write("tool.completed", { toolId, durationMs });
  };

  const onToolFailed = (toolId: string, error: Error): void => {
    write("tool.failed", { toolId, error: errorToJson(error) });
  };

  registry.events.on("serviceStateChange", onServiceStateChange);
  registry.events.on("serviceError", onServiceError);
  registry.events.on("serviceRegistered", onServiceRegistered);
  registry.events.on("toolRegistered", onToolRegistered);
  registry.events.on("toolInvoked", onToolInvoked);
  registry.events.on("toolCompleted", onToolCompleted);
  registry.events.on("toolFailed", onToolFailed);

  return {
    filePath,
    dispose: flush,
  };
}
