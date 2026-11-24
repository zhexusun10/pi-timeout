import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, resolve } from "node:path";

function resolveDestinationPath(path: string, existing: Stats | undefined): string {
  if (!existing?.isSymbolicLink()) return path;
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return resolve(dirname(path), readlinkSync(path));
    }
    throw error;
  }
}

function renameWithRetry(source: string, destination: string): void {
  const maxAttempts = process.platform === "win32" ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < maxAttempts && (code === "EPERM" || code === "EBUSY")) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * attempt);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Replace a small local file only after the new contents are fully written.
 * Failures leave the previous file untouched; configured symlinks keep pointing
 * at the same target.
 */
export function writeFileAtomically(path: string, contents: string): boolean {
  let temporary: string | undefined;
  try {
    let existing: Stats | undefined;
    try {
      existing = lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const destination = resolveDestinationPath(path, existing);
    if (existing && !existing.isSymbolicLink() && !existing.isFile()) return false;
    mkdirSync(dirname(destination), { recursive: true });
    const candidate = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const file = openSync(candidate, "wx", 0o600);
    temporary = candidate;
    try {
      writeFileSync(file, contents, "utf8");
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameWithRetry(candidate, destination);
    temporary = undefined;
    return true;
  } catch {
    return false;
  } finally {
    if (temporary) {
      try {
        unlinkSync(temporary);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}
