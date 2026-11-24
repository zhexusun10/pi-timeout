import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeFileAtomically } from "./atomic-file.ts";

/** Default bash timeout applied when the model does not pass `timeout`. */
export const DEFAULT_BASH_TIMEOUT_SECONDS = 180;

/** Matches Pi's built-in bash tool maximum (`2_147_483_647 ms`). */
export const MAX_BASH_TIMEOUT_SECONDS = 2_147_483.647;

/** Quick-select presets shown in the `/timeout` TUI selector. */
export const TIMEOUT_PRESETS = [30, 60, 120, 180, 300, 600] as const;

export interface TimeoutSettings {
  version: 1;
  /** Positive timeout in seconds, or `null` to disable the default timeout. */
  defaultTimeoutSeconds: number | null;
}

export type ParseTimeoutResult =
  | { ok: true; timeoutSeconds: number | null }
  | { ok: false; error: string };

const TIMEOUT_INPUT_PATTERN =
  /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/i;

export function getSettingsPath(): string {
  return process.env.PI_TIMEOUT_SETTINGS || join(getAgentDir(), "pi-timeout.json");
}

export function isValidTimeoutSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_BASH_TIMEOUT_SECONDS
  );
}

export function createDefaultSettings(): TimeoutSettings {
  return {
    version: 1,
    defaultTimeoutSeconds: DEFAULT_BASH_TIMEOUT_SECONDS,
  };
}

export function formatTimeoutSeconds(seconds: number): string {
  return `${seconds}s`;
}

export function formatTimeoutDetailed(seconds: number | null): string {
  if (seconds === null) return "off (no default)";
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `${seconds}s (${seconds / 3600}h)`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds}s (${seconds / 60}m)`;
  }
  return `${seconds}s`;
}

export function parseTimeoutInput(raw: string): ParseTimeoutResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Timeout value cannot be empty." };
  }

  const lowered = trimmed.toLowerCase();
  if (lowered === "default" || lowered === "reset") {
    return { ok: true, timeoutSeconds: DEFAULT_BASH_TIMEOUT_SECONDS };
  }
  if (lowered === "off" || lowered === "none" || lowered === "disable" || lowered === "disabled") {
    return { ok: true, timeoutSeconds: null };
  }

  const match = TIMEOUT_INPUT_PATTERN.exec(trimmed);
  if (!match) {
    return {
      ok: false,
      error: `Invalid timeout "${trimmed}". Enter positive seconds (e.g. 180, 90s, 5m), "default", or "off".`,
    };
  }

  const rawNumber = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const multiplier = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
  const computed = rawNumber * multiplier;

  if (!Number.isFinite(computed) || computed <= 0) {
    return {
      ok: false,
      error: "Timeout must be a positive number of seconds.",
    };
  }

  const normalized = Math.round(computed * 1000) / 1000;
  if (normalized <= 0) {
    return {
      ok: false,
      error: "Timeout must be at least 0.001 seconds.",
    };
  }
  if (normalized > MAX_BASH_TIMEOUT_SECONDS) {
    return {
      ok: false,
      error: `Timeout cannot exceed ${MAX_BASH_TIMEOUT_SECONDS} seconds.`,
    };
  }

  return { ok: true, timeoutSeconds: normalized };
}

export function readTimeoutSettings(settingsPath = getSettingsPath()): TimeoutSettings {
  const fallback = createDefaultSettings();
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) return fallback;
    const value = record.defaultTimeoutSeconds;
    if (value === null) {
      return { version: 1, defaultTimeoutSeconds: null };
    }
    if (isValidTimeoutSeconds(value)) {
      return { version: 1, defaultTimeoutSeconds: value };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeTimeoutSettings(settings: TimeoutSettings, settingsPath = getSettingsPath()): boolean {
  const value = settings.defaultTimeoutSeconds;
  if (value !== null && !isValidTimeoutSeconds(value)) {
    return false;
  }
  const persisted: TimeoutSettings = {
    version: 1,
    defaultTimeoutSeconds: value,
  };
  return writeFileAtomically(settingsPath, `${JSON.stringify(persisted, null, 2)}\n`);
}
