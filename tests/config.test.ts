import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_BASH_TIMEOUT_SECONDS,
  formatTimeoutDetailed,
  MAX_BASH_TIMEOUT_SECONDS,
  parseTimeoutInput,
  readTimeoutSettings,
  writeTimeoutSettings,
} from "../lib/config.ts";

describe("config parsing and formatting", () => {
  it("defaults to 180 seconds", () => {
    assert.equal(DEFAULT_BASH_TIMEOUT_SECONDS, 180);
  });

  it("parses seconds, minutes, hours, decimals, reset/default, and off/none", () => {
    assert.deepEqual(parseTimeoutInput("180"), { ok: true, timeoutSeconds: 180 });
    assert.deepEqual(parseTimeoutInput("90s"), { ok: true, timeoutSeconds: 90 });
    assert.deepEqual(parseTimeoutInput("0.5s"), { ok: true, timeoutSeconds: 0.5 });
    assert.deepEqual(parseTimeoutInput("3m"), { ok: true, timeoutSeconds: 180 });
    assert.deepEqual(parseTimeoutInput("1.5 minutes"), { ok: true, timeoutSeconds: 90 });
    assert.deepEqual(parseTimeoutInput("1h"), { ok: true, timeoutSeconds: 3600 });
    assert.deepEqual(parseTimeoutInput("default"), { ok: true, timeoutSeconds: 180 });
    assert.deepEqual(parseTimeoutInput("RESET"), { ok: true, timeoutSeconds: 180 });
    assert.deepEqual(parseTimeoutInput("off"), { ok: true, timeoutSeconds: null });
    assert.deepEqual(parseTimeoutInput("none"), { ok: true, timeoutSeconds: null });
    assert.deepEqual(parseTimeoutInput("disabled"), { ok: true, timeoutSeconds: null });
  });

  it("rejects empty, zero, negative, sub-millisecond, overflowing, and malformed values", () => {
    for (const invalid of ["", "   ", "0", "0s", "-10", "-1m", "0.0001", "abc", "10d", `${MAX_BASH_TIMEOUT_SECONDS + 1}`]) {
      const result = parseTimeoutInput(invalid);
      assert.equal(result.ok, false, `Expected "${invalid}" to fail validation`);
    }
  });

  it("formats timeout values for display", () => {
    assert.equal(formatTimeoutDetailed(null), "off (no default)");
    assert.equal(formatTimeoutDetailed(30), "30s");
    assert.equal(formatTimeoutDetailed(45.5), "45.5s");
    assert.equal(formatTimeoutDetailed(180), "180s (3m)");
    assert.equal(formatTimeoutDetailed(3600), "3600s (1h)");
  });
});

describe("settings persistence", () => {
  it("falls back to 180s when file is missing or invalid, and persists updates atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-timeout-config-"));
    try {
      const file = join(dir, "pi-timeout.json");

      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: 180 });

      assert.equal(writeTimeoutSettings({ version: 1, defaultTimeoutSeconds: 90 }, file), true);
      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: 90 });

      assert.equal(writeTimeoutSettings({ version: 1, defaultTimeoutSeconds: null }, file), true);
      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: null });

      assert.equal(writeTimeoutSettings({ version: 1, defaultTimeoutSeconds: 0 }, file), false);
      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: null });

      writeFileSync(file, "{not valid json", "utf8");
      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: 180 });

      writeFileSync(file, JSON.stringify({ version: 2, defaultTimeoutSeconds: 60 }), "utf8");
      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: 180 });

      writeFileSync(file, JSON.stringify({ version: 1, defaultTimeoutSeconds: -5 }), "utf8");
      assert.deepEqual(readTimeoutSettings(file), { version: 1, defaultTimeoutSeconds: 180 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
