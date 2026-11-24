import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type RegisteredCommand,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import piTimeout from "../extensions/index.ts";
import { readTimeoutSettings } from "../lib/config.ts";
import { TIMEOUT_COMMAND_NAME } from "../lib/timeout-command.ts";

interface FakeHarness {
  tools: Map<string, ToolDefinition>;
  commands: Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>;
  handlers: Map<string, Array<(event: any, ctx: any) => unknown>>;
  pi: ExtensionAPI;
}

function createFakePi(): FakeHarness {
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();

  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) {
      commands.set(name, options);
    },
    on(event: string, handler: (event: any, ctx: any) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
  } as unknown as ExtensionAPI;

  return { tools, commands, handlers, pi };
}

function getTimeoutDescription(tools: Map<string, ToolDefinition>): string | undefined {
  const bash = tools.get("bash");
  const properties = (bash?.parameters as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
  return properties?.timeout?.description;
}

function createCommandContext(options: {
  hasUI?: boolean;
  selectResult?: string | ((title: string, choices: string[]) => string | undefined);
  inputResult?: string | ((title: string, placeholder?: string) => string | undefined);
  cwd?: string;
} = {}) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const selectCalls: Array<{ title: string; choices: string[] }> = [];
  const inputCalls: Array<{ title: string; placeholder?: string }> = [];

  const ctx = {
    cwd: options.cwd ?? process.cwd(),
    hasUI: options.hasUI ?? true,
    ui: {
      notify(message: string, type?: "info" | "warning" | "error") {
        notifications.push({ message, type });
      },
      async select(title: string, choices: string[]) {
        selectCalls.push({ title, choices });
        if (typeof options.selectResult === "function") {
          return options.selectResult(title, choices);
        }
        return options.selectResult;
      },
      async input(title: string, placeholder?: string) {
        inputCalls.push({ title, placeholder });
        if (typeof options.inputResult === "function") {
          return options.inputResult(title, placeholder);
        }
        return options.inputResult;
      },
    },
  } as unknown as ExtensionCommandContext;

  return { ctx, notifications, selectCalls, inputCalls };
}

function withIsolatedSettings<T>(fn: (settingsPath: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "pi-timeout-ext-"));
  const settingsPath = join(dir, "pi-timeout.json");
  const prev = process.env.PI_TIMEOUT_SETTINGS;
  process.env.PI_TIMEOUT_SETTINGS = settingsPath;
  return Promise.resolve()
    .then(() => fn(settingsPath))
    .finally(() => {
      if (prev === undefined) delete process.env.PI_TIMEOUT_SETTINGS;
      else process.env.PI_TIMEOUT_SETTINGS = prev;
      rmSync(dir, { recursive: true, force: true });
    });
}

describe("pi-timeout extension", () => {
  it("registers bash with default 180s schema and updates via TUI selector, custom input, disable, and reset", async () => {
    await withIsolatedSettings(async (settingsPath) => {
      const harness = createFakePi();
      piTimeout(harness.pi);

      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 180s)");
      const command = harness.commands.get(TIMEOUT_COMMAND_NAME);
      assert.ok(command, "Expected /timeout command to be registered");

      // Argument completions
      const allCompletions = await command.getArgumentCompletions?.("");
      assert.ok(allCompletions && allCompletions.some((item) => item.value === "180s"));
      const resetCompletions = await command.getArgumentCompletions?.("re");
      assert.deepEqual(resetCompletions?.map((item) => item.value), ["reset"]);

      // Select preset 60s via TUI
      const presetRun = createCommandContext({
        selectResult: (_title, choices) => choices.find((c) => c.startsWith("60s")),
      });
      await command.handler("", presetRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 60s)");
      assert.deepEqual(readTimeoutSettings(settingsPath), { version: 1, defaultTimeoutSeconds: 60 });
      assert.equal(presetRun.notifications.at(-1)?.type, "info");

      // Enter custom timeout via TUI (e.g. 2.5m -> 150s)
      const customRun = createCommandContext({
        selectResult: (_title, choices) => choices.find((c) => c.startsWith("Custom...")),
        inputResult: "2.5m",
      });
      await command.handler("", customRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 150s)");
      assert.deepEqual(readTimeoutSettings(settingsPath), { version: 1, defaultTimeoutSeconds: 150 });

      // Cancel TUI dialog leaves setting untouched
      const cancelRun = createCommandContext({ selectResult: undefined });
      await command.handler("", cancelRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 150s)");

      // Disable via TUI
      const disableRun = createCommandContext({
        selectResult: (_title, choices) => choices.find((c) => c.startsWith("Disable")),
      });
      await command.handler("", disableRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, no default timeout)");
      assert.deepEqual(readTimeoutSettings(settingsPath), { version: 1, defaultTimeoutSeconds: null });

      // Reset via TUI
      const resetRun = createCommandContext({
        selectResult: (_title, choices) => choices.find((c) => c.startsWith("Reset to default")),
      });
      await command.handler("", resetRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 180s)");
      assert.deepEqual(readTimeoutSettings(settingsPath), { version: 1, defaultTimeoutSeconds: 180 });
    });
  });

  it("supports direct /timeout arguments and non-interactive reporting", async () => {
    await withIsolatedSettings(async (settingsPath) => {
      const harness = createFakePi();
      piTimeout(harness.pi);
      const command = harness.commands.get(TIMEOUT_COMMAND_NAME)!;

      const setRun = createCommandContext({ hasUI: false });
      await command.handler("45", setRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 45s)");
      assert.deepEqual(readTimeoutSettings(settingsPath), { version: 1, defaultTimeoutSeconds: 45 });

      const statusRun = createCommandContext({ hasUI: false });
      await command.handler("", statusRun.ctx);
      assert.match(statusRun.notifications[0]?.message ?? "", /45s/);

      const statusCmdRun = createCommandContext({ hasUI: true });
      await command.handler("status", statusCmdRun.ctx);
      assert.equal(statusCmdRun.notifications[0]?.type, "info");
      assert.match(statusCmdRun.notifications[0]?.message ?? "", /45s/);

      const invalidRun = createCommandContext({ hasUI: true });
      await command.handler("-10", invalidRun.ctx);
      assert.equal(invalidRun.notifications[0]?.type, "warning");
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 45s)");

      const resetRun = createCommandContext({ hasUI: false });
      await command.handler("reset", resetRun.ctx);
      assert.equal(getTimeoutDescription(harness.tools), "Timeout in seconds (optional, default 180s)");
    });
  });

  it("integrates with AgentSession and updates the active bash schema dynamically", async () => {
    await withIsolatedSettings(async (settingsPath) => {
      const cwd = process.cwd();
      const agentDir = join(settingsPath, "..", "agent");
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [piTimeout],
      });
      await loader.reload();

      const { session } = await createAgentSession({
        cwd,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.inMemory(),
      });

      try {
        const initialBash = session.getToolDefinition("bash");
        assert.ok(initialBash, "Expected bash tool definition in session");
        const initialProps = (initialBash.parameters as { properties?: Record<string, { description?: string }> }).properties;
        assert.equal(initialProps?.timeout?.description, "Timeout in seconds (optional, default 180s)");

        const initialModelBash = session.agent.state.tools.find((t) => t.name === "bash");
        const initialModelProps = (initialModelBash?.parameters as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
        assert.equal(initialModelProps?.timeout?.description, "Timeout in seconds (optional, default 180s)");

        const timeoutCmd = session.extensionRunner.getCommand(TIMEOUT_COMMAND_NAME);
        assert.ok(timeoutCmd, "Expected /timeout command in session");

        const { ctx } = createCommandContext({ hasUI: false, cwd });
        await timeoutCmd.handler("75", ctx);

        const updatedBash = session.getToolDefinition("bash");
        const updatedProps = (updatedBash?.parameters as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
        assert.equal(updatedProps?.timeout?.description, "Timeout in seconds (optional, default 75s)");

        const updatedModelBash = session.agent.state.tools.find((t) => t.name === "bash");
        const updatedModelProps = (updatedModelBash?.parameters as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
        assert.equal(updatedModelProps?.timeout?.description, "Timeout in seconds (optional, default 75s)");
      } finally {
        session.dispose();
      }
    });
  });

  it("does not force-activate bash when disabled via --tools -bash, --tools allowlist, or --no-builtin-tools", async () => {
    await withIsolatedSettings(async (settingsPath) => {
      const cwd = process.cwd();
      const agentDir = join(settingsPath, "..", "agent");
      const scenarios = [
        { label: "-bash modifier", options: { tools: ["-bash"] } },
        { label: "read,edit allowlist", options: { tools: ["read", "edit"] } },
        { label: "noTools builtin", options: { noTools: "builtin" as const } },
      ];

      for (const scenario of scenarios) {
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          extensionFactories: [piTimeout],
        });
        await loader.reload();

        const { session } = await createAgentSession({
          cwd,
          resourceLoader: loader,
          sessionManager: SessionManager.inMemory(cwd),
          settingsManager: SettingsManager.inMemory(),
          ...scenario.options,
        });
        try {
          assert.equal(
            session.getActiveToolNames().includes("bash"),
            false,
            `Expected bash to stay inactive for ${scenario.label}`,
          );
          const timeoutCmd = session.extensionRunner.getCommand(TIMEOUT_COMMAND_NAME);
          assert.ok(timeoutCmd);
          const { ctx } = createCommandContext({ hasUI: false, cwd });
          await timeoutCmd.handler("60", ctx);
          assert.equal(
            session.getActiveToolNames().includes("bash"),
            false,
            `Expected bash to stay inactive after /timeout update for ${scenario.label}`,
          );
        } finally {
          session.dispose();
        }
      }
    });
  });
});
