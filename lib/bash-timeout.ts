import {
  type BashToolDetails,
  type BashToolOptions,
  createBashToolDefinition,
  getAgentDir,
  ProjectTrustStore,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const BASH_TIMEOUT_STATUS_PATTERN = /(^|\n\n)(Command timed out after [^\n]+)$/;

export function formatTimeoutFieldDescription(defaultTimeoutSeconds: number | null): string {
  if (defaultTimeoutSeconds === null) {
    return "Timeout in seconds (optional, no default timeout)";
  }
  return `Timeout in seconds (optional, default ${defaultTimeoutSeconds}s)`;
}

export function createBashTimeoutSchema(defaultTimeoutSeconds: number | null) {
  return Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    timeout: Type.Optional(
      Type.Number({ description: formatTimeoutFieldDescription(defaultTimeoutSeconds) }),
    ),
  });
}

export type BashTimeoutSchema = ReturnType<typeof createBashTimeoutSchema>;

/**
 * Prefix Pi's trailing bash timeout status with `Default timeout: ` when a
 * command timed out due to the extension's default timeout rather than an
 * explicit timeout argument from the model.
 */
export function prefixDefaultTimeoutMessage(message: string): string {
  return message.replace(BASH_TIMEOUT_STATUS_PATTERN, "$1Default timeout: $2");
}

export function resolveBashToolOptionsForCwd(cwd: string): BashToolOptions {
  try {
    const agentDir = getAgentDir();
    let projectTrusted = false;
    try {
      projectTrusted = new ProjectTrustStore(agentDir).get(cwd) === true;
    } catch {
      projectTrusted = false;
    }
    const settings = SettingsManager.create(cwd, agentDir, { projectTrusted });
    const shellPath = settings.getShellPath();
    const commandPrefix = settings.getShellCommandPrefix();
    return {
      ...(shellPath ? { shellPath } : {}),
      ...(commandPrefix ? { commandPrefix } : {}),
    };
  } catch {
    return {};
  }
}

export interface DefaultTimeoutBashToolOptions {
  cwd: string;
  getDefaultTimeoutSeconds: () => number | null;
  /** Optional explicit BashToolOptions (primarily for tests or custom operations). */
  baseOptions?: BashToolOptions;
  /** Optional factory override for unit tests. */
  createBaseDefinition?: typeof createBashToolDefinition;
}

export function createDefaultTimeoutBashToolDefinition(
  options: DefaultTimeoutBashToolOptions,
): ToolDefinition<BashTimeoutSchema, BashToolDetails | undefined> {
  const createBase = options.createBaseDefinition ?? createBashToolDefinition;
  const resolveBase = (targetCwd: string) =>
    createBase(targetCwd, options.baseOptions ?? resolveBashToolOptionsForCwd(targetCwd));

  let cachedCwd = options.cwd;
  let cachedBase = resolveBase(cachedCwd);

  const getBaseForCwd = (targetCwd: string) => {
    if (targetCwd !== cachedCwd) {
      cachedCwd = targetCwd;
      cachedBase = resolveBase(targetCwd);
    }
    return cachedBase;
  };

  return {
    ...cachedBase,
    parameters: createBashTimeoutSchema(options.getDefaultTimeoutSeconds()),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const configuredDefault = options.getDefaultTimeoutSeconds();
      const usedDefaultTimeout = params.timeout === undefined && configuredDefault !== null;
      const effectiveParams = usedDefaultTimeout
        ? { ...params, timeout: configuredDefault }
        : params;
      const activeBase = getBaseForCwd(ctx?.cwd || options.cwd);

      try {
        return await activeBase.execute(toolCallId, effectiveParams, signal, onUpdate, ctx);
      } catch (err) {
        if (usedDefaultTimeout && err instanceof Error) {
          const rewritten = prefixDefaultTimeoutMessage(err.message);
          if (rewritten !== err.message) {
            throw new Error(rewritten);
          }
        }
        throw err;
      }
    },
  };
}
