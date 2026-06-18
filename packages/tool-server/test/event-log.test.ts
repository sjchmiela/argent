import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Registry } from "@argent/registry";
import { attachRegistryEventLogger, createToolServerEventLog } from "../src/event-log";

function eventLogPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "argent-events-")), "events.jsonl");
}

function readEvents(filePath: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("createToolServerEventLog", () => {
  it("records structured events as JSONL", () => {
    const filePath = eventLogPath();
    const eventLog = createToolServerEventLog(filePath);

    eventLog.log({
      type: "tool_server.started",
      msg: "Tool server started on http://127.0.0.1:3001.",
      origin: "http://127.0.0.1:3001",
      host: "127.0.0.1",
      port: 3001,
      pid: 123,
    });
    eventLog.dispose();

    expect(readEvents(filePath)).toEqual([
      expect.objectContaining({
        time: expect.any(String),
        msg: "Tool server started on http://127.0.0.1:3001.",
        type: "tool_server.started",
        origin: "http://127.0.0.1:3001",
        host: "127.0.0.1",
        port: 3001,
        pid: 123,
      }),
    ]);
  });

  it("starts a fresh event log file", () => {
    const filePath = eventLogPath();
    fs.writeFileSync(filePath, "stale\n");

    const eventLog = createToolServerEventLog(filePath);
    eventLog.log({ type: "tool_server.started", msg: "Tool server started." });
    eventLog.dispose();

    expect(fs.readFileSync(filePath, "utf8")).not.toContain("stale");
    expect(readEvents(filePath)).toHaveLength(1);
  });
});

describe("attachRegistryEventLogger", () => {
  it("records registry lifecycle events into the tool-server event log", () => {
    const registry = new Registry();
    const filePath = eventLogPath();
    const eventLog = createToolServerEventLog(filePath);
    attachRegistryEventLogger(registry, eventLog);

    registry.events.emit("toolInvoked", "screenshot");
    registry.events.emit("toolCompleted", "screenshot", 12.34);
    eventLog.dispose();

    expect(readEvents(filePath)).toEqual([
      expect.objectContaining({
        time: expect.any(String),
        msg: "Tool screenshot was invoked.",
        type: "tool.invoked",
        toolId: "screenshot",
      }),
      expect.objectContaining({
        time: expect.any(String),
        msg: "Tool screenshot completed in 12.34 ms.",
        type: "tool.completed",
        toolId: "screenshot",
        durationMs: 12.34,
      }),
    ]);
  });

  it("serializes failed tool errors with nested causes", () => {
    const registry = new Registry();
    const filePath = eventLogPath();
    const eventLog = createToolServerEventLog(filePath);
    attachRegistryEventLogger(registry, eventLog);

    const cause = new Error("socket closed");
    registry.events.emit(
      "toolFailed",
      "debugger-evaluate",
      new Error("evaluate failed", { cause })
    );
    eventLog.dispose();

    const [event] = readEvents(filePath);
    expect(event).toMatchObject({
      msg: "Tool debugger-evaluate failed.",
      type: "tool.failed",
      toolId: "debugger-evaluate",
      error: {
        name: "Error",
        message: "evaluate failed",
        cause: {
          name: "Error",
          message: "socket closed",
        },
      },
    });
  });
});
