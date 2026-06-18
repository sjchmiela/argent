import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Registry, ServiceState } from "@argent/registry";

export type EventLogValue =
  | string
  | number
  | boolean
  | null
  | EventLogValue[]
  | { [key: string]: EventLogValue | undefined };

export type EventLogRecord = { type: string; msg: string } & Record<
  string,
  EventLogValue | undefined
>;

export interface ToolServerEventLog {
  filePath: string;
  log: (record: EventLogRecord) => void;
  dispose: () => void;
}

function errorToJson(error: Error): EventLogValue {
  const cause = error.cause instanceof Error ? errorToJson(error.cause) : undefined;
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(cause ? { cause } : {}),
  };
}

export function createToolServerEventLog(filePath: string): ToolServerEventLog {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");

  let buffer: string[] = [];

  function flush(): void {
    if (buffer.length === 0) return;
    const pending = buffer;
    buffer = [];
    appendFileSync(filePath, pending.join(""));
  }

  return {
    filePath,
    log: (record) => {
      const event = {
        time: new Date().toISOString(),
        ...record,
      };
      buffer.push(JSON.stringify(event) + "\n");
    },
    dispose: flush,
  };
}

export function attachRegistryEventLogger(registry: Registry, eventLog: ToolServerEventLog): void {
  registry.events.on(
    "serviceStateChange",
    (serviceId: string, from: ServiceState, to: ServiceState) => {
      eventLog.log({
        type: "service.state_change",
        msg: `Service ${serviceId} changed state from ${from} to ${to}.`,
        serviceId,
        from,
        to,
      });
    }
  );

  registry.events.on("serviceError", (serviceId: string, error: Error) => {
    eventLog.log({
      type: "service.error",
      msg: `Service ${serviceId} failed.`,
      serviceId,
      error: errorToJson(error),
    });
  });

  registry.events.on("serviceRegistered", (serviceId: string) => {
    eventLog.log({
      type: "service.registered",
      msg: `Service ${serviceId} was registered.`,
      serviceId,
    });
  });

  registry.events.on("toolRegistered", (toolId: string) => {
    eventLog.log({
      type: "tool.registered",
      msg: `Tool ${toolId} was registered.`,
      toolId,
    });
  });

  registry.events.on("toolInvoked", (toolId: string) => {
    eventLog.log({
      type: "tool.invoked",
      msg: `Tool ${toolId} was invoked.`,
      toolId,
    });
  });

  registry.events.on("toolCompleted", (toolId: string, durationMs: number) => {
    eventLog.log({
      type: "tool.completed",
      msg: `Tool ${toolId} completed in ${durationMs.toFixed(2)} ms.`,
      toolId,
      durationMs,
    });
  });

  registry.events.on("toolFailed", (toolId: string, error: Error) => {
    eventLog.log({
      type: "tool.failed",
      msg: `Tool ${toolId} failed.`,
      toolId,
      error: errorToJson(error),
    });
  });
}
