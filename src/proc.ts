import { spawn } from "node:child_process";

export interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a command, streaming its output to our stderr so the user sees live
 * progress (Playwright, ffmpeg, Remotion). Resolves with the exit code; never
 * rejects on a non-zero exit so callers decide how to treat failures.
 */
export function run(
  cmd: string,
  args: string[],
  opts: RunOpts = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
      shell: process.platform === "win32", // resolve .cmd shims on Windows
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

/** Like run(), but capture stdout instead of inheriting it. */
export function capture(
  cmd: string,
  args: string[],
  opts: RunOpts = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return captureWithInput(cmd, args, undefined, opts);
}

/**
 * Capture stdout/stderr, optionally writing `input` to the child's stdin. Used to
 * feed large prompts to the Claude CLI without hitting command-line length limits.
 */
export function captureWithInput(
  cmd: string,
  args: string[],
  input: string | undefined,
  opts: RunOpts = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}
