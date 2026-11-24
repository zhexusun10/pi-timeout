import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BashOperations, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import {
  createBashTimeoutSchema,
  createDefaultTimeoutBashToolDefinition,
  formatTimeoutFieldDescription,
  prefixDefaultTimeoutMessage,
} from "../lib/bash-timeout.ts";

const dummyCtx = { cwd: process.cwd() } as ExtensionToolContext;

describe("bash timeout schema and message formatting", () => {
  it("formats the timeout field description for default, custom, and disabled timeouts", () => {
    assert.equal(formatTimeoutFieldDescription(180), "Timeout in seconds (optional, default 180s)");
    assert.equal(formatTimeoutFieldDescription(45), "Timeout in seconds (optional, default 45s)");
    assert.equal(formatTimeoutFieldDescription(null), "Timeout in seconds (optional, no default timeout)");

    const schema = createBashTimeoutSchema(180);
    assert.equal((schema.properties.command as { description?: string }).description, "Shell command to execute");
    assert.equal(
      (schema.properties.timeout as { description?: string }).description,
      "Timeout in seconds (optional, default 180s)",
    );
  });

  it("prefixes default timeout status cleanly without affecting non-timeout messages", () => {
    assert.equal(
      prefixDefaultTimeoutMessage("Command timed out after 180 seconds"),
      "Default timeout: Command timed out after 180 seconds",
    );
    assert.equal(
      prefixDefaultTimeoutMessage("partial output\n\nCommand timed out after 180 seconds"),
      "partial output\n\nDefault timeout: Command timed out after 180 seconds",
    );
    assert.equal(
      prefixDefaultTimeoutMessage(
        "Command timed out after 180 seconds. The shell exited with code 0 after 1.2 seconds, but background processes it started kept writing output until the timeout.",
      ),
      "Default timeout: Command timed out after 180 seconds. The shell exited with code 0 after 1.2 seconds, but background processes it started kept writing output until the timeout.",
    );
    assert.equal(
      prefixDefaultTimeoutMessage("Default timeout: Command timed out after 180 seconds"),
      "Default timeout: Command timed out after 180 seconds",
    );
    assert.equal(prefixDefaultTimeoutMessage("Command aborted"), "Command aborted");
    assert.equal(
      prefixDefaultTimeoutMessage("Command timed out after 180 seconds\n\nCommand aborted"),
      "Command timed out after 180 seconds\n\nCommand aborted",
    );
  });
});

describe("bash tool execution with default timeout", () => {
  it("applies default timeout when agent omits timeout and prefixes timeout return with Default timeout:", async () => {
    let seenTimeout: number | undefined;
    const ops: BashOperations = {
      exec: async (_command, _cwd, { onData, timeout }) => {
        seenTimeout = timeout;
        onData(Buffer.from("still working..."));
        throw new Error(`timeout:${timeout}`);
      },
    };

    const tool = createDefaultTimeoutBashToolDefinition({
      cwd: process.cwd(),
      getDefaultTimeoutSeconds: () => 180,
      baseOptions: { operations: ops, exposeSessionEnvironment: false },
    });

    await assert.rejects(
      () => tool.execute("call-1", { command: "sleep 300" }, undefined, undefined, dummyCtx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "still working...\n\nDefault timeout: Command timed out after 180 seconds");
        return true;
      },
    );
    assert.equal(seenTimeout, 180);
  });

  it("does NOT prefix Default timeout when agent explicitly specifies timeout", async () => {
    const seenTimeouts: Array<number | undefined> = [];
    const ops: BashOperations = {
      exec: async (_command, _cwd, { timeout }) => {
        seenTimeouts.push(timeout);
        throw new Error(`timeout:${timeout}`);
      },
    };

    const tool = createDefaultTimeoutBashToolDefinition({
      cwd: process.cwd(),
      getDefaultTimeoutSeconds: () => 180,
      baseOptions: { operations: ops, exposeSessionEnvironment: false },
    });

    await assert.rejects(
      () => tool.execute("call-2", { command: "sleep 300", timeout: 15 }, undefined, undefined, dummyCtx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "Command timed out after 15 seconds");
        return true;
      },
    );

    // Even when explicit timeout equals default (180), it was explicitly requested by the model.
    await assert.rejects(
      () => tool.execute("call-3", { command: "sleep 300", timeout: 180 }, undefined, undefined, dummyCtx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "Command timed out after 180 seconds");
        return true;
      },
    );

    assert.deepEqual(seenTimeouts, [15, 180]);
  });

  it("passes undefined timeout when default timeout is disabled", async () => {
    let seenTimeout: number | undefined = 999;
    const ops: BashOperations = {
      exec: async (_command, _cwd, { onData, timeout }) => {
        seenTimeout = timeout;
        onData(Buffer.from("done\n"));
        return { exitCode: 0 };
      },
    };

    const tool = createDefaultTimeoutBashToolDefinition({
      cwd: process.cwd(),
      getDefaultTimeoutSeconds: () => null,
      baseOptions: { operations: ops, exposeSessionEnvironment: false },
    });

    const result = await tool.execute("call-4", { command: "echo done" }, undefined, undefined, dummyCtx);
    assert.equal(seenTimeout, undefined);
    assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "done\n");
  });

  it("preserves abort and non-zero exit behavior unchanged", async () => {
    const abortOps: BashOperations = {
      exec: async () => {
        throw new Error("aborted");
      },
    };
    const abortTool = createDefaultTimeoutBashToolDefinition({
      cwd: process.cwd(),
      getDefaultTimeoutSeconds: () => 180,
      baseOptions: { operations: abortOps, exposeSessionEnvironment: false },
    });
    await assert.rejects(
      () => abortTool.execute("call-5", { command: "sleep 10" }, undefined, undefined, dummyCtx),
      (err: unknown) => err instanceof Error && err.message === "Command aborted",
    );

    const exitOps: BashOperations = {
      exec: async (_command, _cwd, { onData }) => {
        onData(Buffer.from("Command timed out after 180 seconds"));
        return { exitCode: 2 };
      },
    };
    const exitTool = createDefaultTimeoutBashToolDefinition({
      cwd: process.cwd(),
      getDefaultTimeoutSeconds: () => 180,
      baseOptions: { operations: exitOps, exposeSessionEnvironment: false },
    });
    const result = await exitTool.execute("call-6", { command: "false" }, undefined, undefined, dummyCtx);
    assert.equal(result.isError, true);
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    assert.equal(text, "Command timed out after 180 seconds\n\nCommand exited with code 2");
  });

  it("enforces a real local shell default timeout and distinguishes explicit timeout", async () => {
    const tool = createDefaultTimeoutBashToolDefinition({
      cwd: process.cwd(),
      getDefaultTimeoutSeconds: () => 0.3,
      baseOptions: { exposeSessionEnvironment: false },
    });

    const okResult = await tool.execute("real-ok", { command: "echo hello-pi-timeout" }, undefined, undefined, dummyCtx);
    const okText = okResult.content[0]?.type === "text" ? okResult.content[0].text : "";
    assert.match(okText, /hello-pi-timeout/);

    await assert.rejects(
      () => tool.execute("real-default-timeout", { command: "sleep 5" }, undefined, undefined, dummyCtx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Default timeout: Command timed out after 0\.3 seconds/);
        return true;
      },
    );

    await assert.rejects(
      () => tool.execute("real-explicit-timeout", { command: "sleep 5", timeout: 0.3 }, undefined, undefined, dummyCtx),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /^Command timed out after 0\.3 seconds/);
        assert.doesNotMatch(err.message, /Default timeout:/);
        return true;
      },
    );
  });
});
