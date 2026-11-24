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
  setTimeoutSeconds: (timeoutSeconds: number | null) => boolean;
}

const COMPLETIONS = [
  ...TIMEOUT_PRESETS.map((s) => ({
    value: `${s}s`,
    label: s === DEFAULT_BASH_TIMEOUT_SECONDS ? `${s}s (default)` : formatTimeoutDetailed(s),
    description: s === DEFAULT_BASH_TIMEOUT_SECONDS ? "Default bash timeout" : "Set bash default timeout",
  })),
  { value: "reset", label: "reset", description: `Reset to default (${DEFAULT_BASH_TIMEOUT_SECONDS}s)` },
  { value: "off", label: "off", description: "Disable default bash timeout" },
];

type MenuChoice = { label: string; value: number | null | "custom" };

function buildMenu(current: number | null): MenuChoice[] {
  const isCustom = current !== null && !(TIMEOUT_PRESETS as readonly number[]).includes(current);
  const choices: MenuChoice[] = TIMEOUT_PRESETS.map((s) => {
    const tags = [s === DEFAULT_BASH_TIMEOUT_SECONDS && "default", current === s && "current"].filter(Boolean);
    return {
      label: tags.length ? `${formatTimeoutDetailed(s)} [${tags.join(", ")}]` : formatTimeoutDetailed(s),
      value: s,
    };
  });

  choices.push({
    label: isCustom
      ? `Custom... — currently ${formatTimeoutDetailed(current)}`
      : "Custom... — enter timeout (e.g. 90, 2m, 300s)",
    value: "custom",
  });
  choices.push({
    label: current === null ? "Disable — no default timeout [current]" : "Disable — no default timeout",
    value: null,
  });
  if (current !== DEFAULT_BASH_TIMEOUT_SECONDS) {
    choices.push({
      label: `Reset to default (${DEFAULT_BASH_TIMEOUT_SECONDS}s)`,
      value: DEFAULT_BASH_TIMEOUT_SECONDS,
    });
  }
  return choices;
}

function applyTimeout(next: number | null, controller: TimeoutCommandController, ctx: ExtensionCommandContext): void {
  const saved = controller.setTimeoutSeconds(next);
  const msg =
    next === null
      ? "Bash default timeout disabled (no default timeout)."
      : `Bash default timeout set to ${formatTimeoutDetailed(next)}.`;
  ctx.ui.notify(
    saved ? msg : `${msg} Applied for this session, but could not save to ${getSettingsPath()}.`,
    saved ? "info" : "warning",
  );
}

export function registerTimeoutCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  controller: TimeoutCommandController,
): void {
  pi.registerCommand(TIMEOUT_COMMAND_NAME, {
    description: `Configure default bash timeout (default: ${DEFAULT_BASH_TIMEOUT_SECONDS}s)`,
    getArgumentCompletions: (prefix) => {
      const q = prefix.trim().toLowerCase();
      const items = q
        ? COMPLETIONS.filter((c) => c.value.startsWith(q) || c.label.toLowerCase().startsWith(q))
        : COMPLETIONS;
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed) {
        const parsed = parseTimeoutInput(trimmed);
        if (!parsed.ok) {
          ctx.ui.notify(`${parsed.error} Usage: /${TIMEOUT_COMMAND_NAME} [<seconds>|90s|5m|reset|off]`, "warning");
          return;
        }
        applyTimeout(parsed.timeoutSeconds, controller, ctx);
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

      const menu = buildMenu(current);
      const selected = await ctx.ui.select(
        `Bash default timeout — current: ${formatTimeoutDetailed(current)}`,
        menu.map((m) => m.label),
      );
      const picked = menu.find((m) => m.label === selected);
      if (!picked) return;

      if (picked.value !== "custom") {
        applyTimeout(picked.value, controller, ctx);
        return;
      }

      const raw = await ctx.ui.input(
        "Enter default bash timeout (e.g. 180, 90s, 5m, reset, or off)",
        `${current ?? DEFAULT_BASH_TIMEOUT_SECONDS}s`,
      );
      if (raw === undefined) return;
      const parsed = parseTimeoutInput(raw);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }
      applyTimeout(parsed.timeoutSeconds, controller, ctx);
    },
  });
}
