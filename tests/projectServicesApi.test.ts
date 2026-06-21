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
      JSON.stringify({ name: "root-service", workspaces: ["packages/*"], scripts: { dev: devScript, start: "node dist/server.js", test: "vitest" } })
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
    expect(listed.body.services).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: "root-service",
          scriptName: "start"
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
  it("remembers running services after the manager restarts", async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "project-services-persist-api-"));
    const projectRoot = path.join(directory, "repo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "persisted-service", scripts: { dev: "next dev" } }));

    context = new AppContext(directory);
    let app = await createHttpApp(context, { dev: false, serveClient: false });
    await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: false })
      .expect(201);
    const listed = await request(app).get("/api/project-services").expect(200);
    const service = listed.body.services.find((candidate: { packageName: string }) => candidate.packageName === "persisted-service");
    fs.writeFileSync(
      path.join(directory, "project-services-runtime.json"),
      JSON.stringify({
        services: [
          {
            serviceId: service.serviceId,
            pid: process.pid,
            startedAt: "2026-06-01T00:00:00Z",
            commandText: service.commandText,
            cwd: service.cwd
          }
        ]
      })
    );

    context.close();
    context = new AppContext(directory);
    app = await createHttpApp(context, { dev: false, serveClient: false });

    const restored = await request(app).get("/api/project-services").expect(200);
    expect(restored.body.services.find((candidate: { serviceId: string }) => candidate.serviceId === service.serviceId)).toMatchObject({
      status: "running",
      pid: process.pid
    });

    const startedAgain = await request(app)
      .post(`/api/project-services/${encodeURIComponent(service.serviceId)}/start`)
      .send({})
      .expect(200);
    expect(startedAgain.body).toMatchObject({ alreadyRunning: true, service: { serviceId: service.serviceId, status: "running", pid: process.pid } });
  });
  it("lists project root batch launchers when no package script is available", async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "project-services-bat-api-"));
    const projectRoot = path.join(directory, "flask-app");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "app.py"), "print('hello')\n");
    fs.writeFileSync(path.join(projectRoot, "start.bat"), '@echo off\r\ncd /d "%~dp0"\r\npython app.py\r\npause\r\n');

    context = new AppContext(directory);
    const app = await createHttpApp(context, { dev: false, serveClient: false });
    await request(app)
      .post("/api/projects")
      .send({ rootPath: projectRoot, includeSubdirectories: false })
      .expect(201);

    const listed = await request(app).get("/api/project-services").expect(200);
    expect(listed.body.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: null,
          scriptName: "start.bat",
          scriptCommand: "python app.py",
          packageManager: "bat",
          commandText: "start.bat",
          cwd: projectRoot,
          status: "stopped"
        })
      ])
    );

    const service = listed.body.services.find((candidate: { scriptName: string }) => candidate.scriptName === "start.bat");
    const started = await request(app)
      .post(`/api/project-services/${encodeURIComponent(service.serviceId)}/start`)
      .send({ dryRun: true })
      .expect(200);
    expect(started.body.service).toMatchObject({ serviceId: service.serviceId, status: "running", commandText: "start.bat" });
  });
});