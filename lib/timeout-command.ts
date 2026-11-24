import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  formatTimeoutDetailed,
  getSettingsPath,
  parseTimeoutInput,
  TIMEOUT_PRESETS,
} from "./config.ts";

export const TIMEOUT_COMMAND_NAME = "timeout";

export interface TimeoutCommandController {
  getTimeoutSeconds: () => number | null;
  /** Apply the new default timeout, refresh the bash tool schema, and persist. Returns whether saving succeeded. */
  setTimeoutSeconds: (timeoutSeconds: number | null) => boolean;
}

const COMPLETION_ITEMS = [
  ...TIMEOUT_PRESETS.map((seconds) => ({
    value: `${seconds}s`,
    label: seconds === DEFAULT_BASH_TIMEOUT_SECONDS ? `${seconds}s (default)` : formatTimeoutDetailed(seconds),
    description: seconds === DEFAULT_BASH_TIMEOUT_SECONDS ? "Default bash timeout" : "Set bash default timeout",
  })),
  { value: "reset", label: "reset", description: `Reset to default (${DEFAULT_BASH_TIMEOUT_SECONDS}s)` },
  { value: "off", label: "off", description: "Disable default bash timeout" },
];

interface MenuChoice {
  label: string;
  action: { kind: "set"; value: number | null } | { kind: "custom" };
}

function buildMenuChoices(current: number | null): MenuChoice[] {
  const isCustom = current !== null && !(TIMEOUT_PRESETS as readonly number[]).includes(current);
  const choices: MenuChoice[] = TIMEOUT_PRESETS.map((seconds) => {
    const tags: string[] = [];
    if (seconds === DEFAULT_BASH_TIMEOUT_SECONDS) tags.push("default");
    if (current === seconds) tags.push("current");
    const base = formatTimeoutDetailed(seconds);
    const label = tags.length > 0 ? `${base} [${tags.join(", ")}]` : base;
    return { label, action: { kind: "set", value: seconds } };
  });

  choices.push({
    label: isCustom
      ? `Custom... — currently ${formatTimeoutDetailed(current)}`
      : "Custom... — enter timeout (e.g. 90, 2m, 300s)",
    action: { kind: "custom" },
  });

  choices.push({
    label: current === null ? "Disable — no default timeout [current]" : "Disable — no default timeout",
    action: { kind: "set", value: null },
  });

  if (current !== DEFAULT_BASH_TIMEOUT_SECONDS) {
    choices.push({
      label: `Reset to default (${DEFAULT_BASH_TIMEOUT_SECONDS}s)`,
      action: { kind: "set", value: DEFAULT_BASH_TIMEOUT_SECONDS },
    });
  }

  return choices;
}

function applyTimeoutChoice(
  nextTimeout: number | null,
  controller: TimeoutCommandController,
  ctx: ExtensionCommandContext,
): void {
  const saved = controller.setTimeoutSeconds(nextTimeout);
  const description =
    nextTimeout === null
      ? "Bash default timeout disabled (no default timeout)."
      : `Bash default timeout set to ${formatTimeoutDetailed(nextTimeout)}.`;

  if (saved) {
    ctx.ui.notify(description, "info");
  } else {
    ctx.ui.notify(
      `${description} Applied for this session, but could not save to ${getSettingsPath()}.`,
      "warning",
    );
  }
}

export function registerTimeoutCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  controller: TimeoutCommandController,
): void {
  pi.registerCommand(TIMEOUT_COMMAND_NAME, {
    description: `Configure default bash timeout (default: ${DEFAULT_BASH_TIMEOUT_SECONDS}s)`,
    getArgumentCompletions: (prefix) => {
      const lowered = prefix.trim().toLowerCase();
      const filtered = lowered
        ? COMPLETION_ITEMS.filter(
            (item) =>
              item.value.toLowerCase().startsWith(lowered) ||
              item.label.toLowerCase().startsWith(lowered),
          )
        : COMPLETION_ITEMS;
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed) {
        const parsed = parseTimeoutInput(trimmed);
        if (!parsed.ok) {
          ctx.ui.notify(
            `${parsed.error} Usage: /${TIMEOUT_COMMAND_NAME} [<seconds>|90s|5m|reset|off]`,
            "warning",
          );
          return;
        }
        applyTimeoutChoice(parsed.timeoutSeconds, controller, ctx);
        return;
      }

      const current = controller.getTimeoutSeconds();
      if (!ctx.hasUI) {
        ctx.ui.notify(
          `Bash default timeout: ${formatTimeoutDetailed(current)}. Usage: /${TIMEOUT_COMMAND_NAME} [<seconds>|90s|5m|reset|off]`,
          "info",
        );
        return;
      }

      const choices = buildMenuChoices(current);
      const selected = await ctx.ui.select(
        `Bash default timeout — current: ${formatTimeoutDetailed(current)}`,
        choices.map((choice) => choice.label),
      );
      if (selected === undefined) return;

      const matched = choices.find((choice) => choice.label === selected);
      if (!matched) return;

      if (matched.action.kind === "set") {
        applyTimeoutChoice(matched.action.value, controller, ctx);
        return;
      }

      const raw = await ctx.ui.input(
        "Enter default bash timeout (e.g. 180, 90s, 5m, reset, or off)",
        current !== null ? `${current}s` : `${DEFAULT_BASH_TIMEOUT_SECONDS}s`,
      );
      if (raw === undefined) return;

      const parsed = parseTimeoutInput(raw);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }
      applyTimeoutChoice(parsed.timeoutSeconds, controller, ctx);
    },
  });
}
