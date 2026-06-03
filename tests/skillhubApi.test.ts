import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
import { createHttpApp } from "../src/server/http/app.js";
import { cleanup, testDir } from "./helpers.js";

let directory: string | null = null;
let context: AppContext | null = null;

afterEach(() => {
  context?.close();
  context = null;
  if (directory) cleanup(directory);
  directory = null;
});

describe("SkillHub API", () => {
  it("returns default config, persists root updates, and imports local skills", async () => {
    directory = testDir("skillhub-api");
    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });

    const empty = await request(app).get("/api/skillhub").set("x-local-api-token", context.token).expect(200);
    expect(empty.body.config.rootDir).toBe(path.join(directory, "skillhub"));
    expect(empty.body.skills).toEqual([]);

    const nextRoot = path.join(directory, "custom-skillhub");
    const updated = await request(app)
      .patch("/api/config")
      .set("x-local-api-token", context.token)
      .send({ skillhub: { rootDir: nextRoot } })
      .expect(200);
    expect(updated.body.skillhub.rootDir).toBe(nextRoot);

    const localSkill = path.join(directory, "local", "review");
    fs.mkdirSync(localSkill, { recursive: true });
    fs.writeFileSync(path.join(localSkill, "SKILL.md"), "---\nname: review\ndescription: API import\n---\n", "utf8");
    const imported = await request(app)
      .post("/api/skillhub/import/local")
      .set("x-local-api-token", context.token)
      .send({ path: localSkill })
      .expect(200);

    expect(imported.body.imported[0]).toMatchObject({ folderName: "review", libraryRelativePath: "skills/review" });
    expect(imported.body.source).toMatchObject({ id: "skills", label: "skills", type: "local" });
    expect(fs.existsSync(path.join(nextRoot, "library", "skills", "review", "SKILL.md"))).toBe(true);

    const listed = await request(app).get("/api/skillhub").set("x-local-api-token", context.token).expect(200);
    expect(listed.body.sources).toEqual([expect.objectContaining({ id: "skills", label: "skills", type: "local" })]);
    expect(listed.body.skills[0].source).toMatchObject({ id: "skills", label: "skills", type: "local" });
  });
});
