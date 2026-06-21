import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AppContext } from "../src/server/appContext.js";
import { createHttpApp } from "../src/server/http/app.js";
import { cleanup } from "./helpers.js";

let directory: string | null = null;
let context: AppContext | null = null;

afterEach(() => {
  context?.close();
  context = null;
  if (directory) cleanup(directory);
  directory = null;
});

describe("Project Services API", () => {
  it("lists startable package scripts and tracks start/stop state", async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "project-services-api-"));
    const projectRoot = path.join(directory, "repo");
    const appRoot = path.join(projectRoot, "packages", "app");
    const devScript = 'node -e "setInterval(() => {}, 1000)"';
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "root-service", workspaces: ["packages/*"], scripts: { dev: devScript, test: "vitest" } })
    );
    fs.writeFileSync(
      path.join(appRoot, "package.json"),
      JSON.stringify({ name: "app-service", packageManager: "pnpm@9.0.0", scripts: { start: "node server.js", build: "tsc" } })
    );

    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: true })
      .expect(201);

    const listed = await request(app).get("/api/project-services").expect(200);
    expect(listed.body.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: "root-service",
          scriptName: "dev",
          scriptCommand: devScript,
          packageManager: "npm",
          commandText: "npm run dev",
          cwd: projectRoot,
          status: "stopped"
        }),
        expect.objectContaining({
          packageName: "app-service",
          scriptName: "start",
          scriptCommand: "node server.js",
          packageManager: "pnpm",
          commandText: "pnpm run start",
          cwd: appRoot,
          status: "stopped"
        })
      ])
    );
    expect(listed.body.services.map((service: { scriptName: string }) => service.scriptName)).not.toContain("test");
    expect(listed.body.services.map((service: { scriptName: string }) => service.scriptName)).not.toContain("build");

    const rootService = listed.body.services.find((service: { packageName: string }) => service.packageName === "root-service");
    const started = await request(app)
      .post(`/api/project-services/${encodeURIComponent(rootService.serviceId)}/start`)
      .send({ dryRun: true });
    expect(started.status, JSON.stringify(started.body)).toBe(200);

    expect(started.body).toMatchObject({
      service: {
        serviceId: rootService.serviceId,
        packageName: "root-service",
        commandText: "npm run dev",
        status: "running",
        exitCode: null
      },
      alreadyRunning: false
    });
    expect(started.body.service.pid).toBeNull();

    const running = await request(app).get("/api/project-services").expect(200);
    expect(running.body.services.find((service: { serviceId: string }) => service.serviceId === rootService.serviceId)).toMatchObject({ status: "running" });

    const stopped = await request(app)
      .post(`/api/project-services/${encodeURIComponent(rootService.serviceId)}/stop`)
      .send({})
      .expect(200);
    expect(stopped.body.service).toMatchObject({ serviceId: rootService.serviceId, status: "stopped" });

    const afterStop = await request(app).get("/api/project-services").expect(200);
    expect(afterStop.body.services.find((service: { serviceId: string }) => service.serviceId === rootService.serviceId)).toMatchObject({ status: "stopped" });
  });
});