import path from "node:path";
import { describe, expect, it } from "vitest";
import { isPathInsideOrEqual, isStrictChildPath, normalizeFsPath } from "../src/server/core/pathUtils.js";

describe("path utilities", () => {
  it("normalizes trailing separators and supports exact matching", () => {
    const root = path.resolve("workspace", "project");
    expect(normalizeFsPath(`${root}${path.sep}`)).toBe(normalizeFsPath(root));
    expect(isPathInsideOrEqual(root, root)).toBe(true);
  });

  it("uses path boundaries for child matching", () => {
    const root = path.resolve("workspace", "app");
    expect(isStrictChildPath(root, path.join(root, "packages", "ui"))).toBe(true);
    expect(isStrictChildPath(root, path.resolve("workspace", "app-other"))).toBe(false);
  });
});
