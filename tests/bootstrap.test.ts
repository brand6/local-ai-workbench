import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBootstrapPath, getDefaultDataDir, resolveBootstrapState, writeBootstrap } from "../src/server/core/bootstrap.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;

afterEach(() => {
  if (directory) cleanup(directory);
  directory = null;
});

describe("bootstrap paths", () => {
  it("uses Local AI Workbench paths for new defaults", () => {
    directory = testDir("bootstrap-defaults");
    const env = {
      APPDATA: path.join(directory, "roaming"),
      LOCALAPPDATA: path.join(directory, "local")
    };

    expect(getDefaultDataDir(env)).toBe(path.join(env.LOCALAPPDATA, "local-ai-workbench"));
    expect(getBootstrapPath(env)).toBe(path.join(env.APPDATA, "local-ai-workbench", "bootstrap.json"));
  });

  it("reads the legacy github-repo-manager bootstrap when the new file is missing", () => {
    directory = testDir("bootstrap-legacy");
    const previousAppData = process.env.APPDATA;
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.APPDATA = path.join(directory, "roaming");
    process.env.LOCALAPPDATA = path.join(directory, "local");
    const dataDir = path.join(directory, "existing-data");
    const legacyBootstrapPath = path.join(process.env.APPDATA, "github-repo-manager", "bootstrap.json");

    try {
      writeBootstrap(dataDir, legacyBootstrapPath);
      const state = resolveBootstrapState(null);

      expect(fs.existsSync(getBootstrapPath())).toBe(false);
      expect(state).toMatchObject({
        initialized: true,
        dataDir,
        defaultDataDir: path.join(process.env.LOCALAPPDATA, "local-ai-workbench"),
        overriddenByArg: false
      });
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
    }
  });
});
