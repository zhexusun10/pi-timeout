import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDefaultTimeoutBashToolDefinition } from "../lib/bash-timeout.ts";
import { readTimeoutSettings, writeTimeoutSettings, type TimeoutSettings } from "../lib/config.ts";
import { registerTimeoutCommand } from "../lib/timeout-command.ts";

export default function piTimeout(pi: ExtensionAPI): void {
  let settings: TimeoutSettings = readTimeoutSettings();
  let currentCwd = process.cwd();

  const registerBash = (): void => {
    pi.registerTool(
      createDefaultTimeoutBashToolDefinition({
        cwd: currentCwd,
        getDefaultTimeoutSeconds: () => settings.defaultTimeoutSeconds,
      }),
    );
  };

  registerBash();

  pi.on("session_start", (_event, ctx) => {
    currentCwd = ctx.cwd;
    settings = readTimeoutSettings();
    registerBash();
  });

  registerTimeoutCommand(pi, {
    getTimeoutSeconds: () => settings.defaultTimeoutSeconds,
    setTimeoutSeconds: (nextTimeout) => {
      settings = { version: 1, defaultTimeoutSeconds: nextTimeout };
      const saved = writeTimeoutSettings(settings);
      registerBash();
      return saved;
    },
  });
}
