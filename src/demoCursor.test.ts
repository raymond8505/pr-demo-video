import { afterAll, describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { centerOf } from "../tests/demoCursor.js";
import { ensureRunDirs, CURSOR_TEMPLATE } from "./paths.js";

describe("centerOf", () => {
  it("returns the midpoint of a bounding box", () => {
    expect(centerOf({ x: 10, y: 20, width: 100, height: 40 })).toEqual({
      x: 60,
      y: 40,
    });
  });

  it("handles a zero-origin box", () => {
    expect(centerOf({ x: 0, y: 0, width: 50, height: 50 })).toEqual({
      x: 25,
      y: 25,
    });
  });
});

describe("ensureRunDirs", () => {
  const runDir = path.join(os.tmpdir(), "prvideo-demo-cursor-test");

  afterAll(async () => {
    await fs.rm(runDir, { recursive: true, force: true });
  });

  it("copies the cursor fixture into the run's specs dir as _demo.ts", async () => {
    await fs.rm(runDir, { recursive: true, force: true });
    const p = await ensureRunDirs(runDir);

    const copied = await fs.readFile(path.join(p.specs, "_demo.ts"), "utf8");
    const source = await fs.readFile(CURSOR_TEMPLATE, "utf8");
    expect(copied).toBe(source);
  });
});
