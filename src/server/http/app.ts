import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { installApi } from "./api.js";
import { installMcpEndpoint } from "./mcp.js";
import type { AppContext } from "../appContext.js";

export interface CreateServerOptions {
  dev: boolean;
  serveClient?: boolean;
}

const INDEX_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

export async function createHttpApp(context: AppContext, options: CreateServerOptions) {
  const app = express();
  installApi(app, context);
  installMcpEndpoint(app, context);

  if (options.serveClient === false) {
    return app;
  }

  if (options.dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: "custom"
    });
    app.use(vite.middlewares);
    app.use((request, response, next) => {
      serveDevIndex(vite, request.originalUrl)
        .then((html) => response.status(200).set(INDEX_HEADERS).end(html))
        .catch(next);
    });
    return app;
  }

  const clientDir = resolveClientDir(path.dirname(fileURLToPath(import.meta.url)));
  app.use(express.static(clientDir, { index: false }));
  app.use((_request, response) => {
    const html = fs.readFileSync(path.join(clientDir, "index.html"), "utf8");
    response.status(200).set(INDEX_HEADERS).end(html);
  });

  return app;
}

function resolveClientDir(currentDir: string): string {
  const candidates = [
    path.resolve(currentDir, "../../../client"),
    path.resolve(currentDir, "../../client"),
    path.resolve(currentDir, "../../../dist/client"),
    path.resolve("dist/client")
  ];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html")));
  if (!found) {
    throw new Error(`Unable to locate built client assets near ${currentDir}`);
  }
  return found;
}

async function serveDevIndex(vite: ViteDevServer, url: string): Promise<string> {
  const template = fs.readFileSync(path.resolve("index.html"), "utf8");
  return vite.transformIndexHtml(url, template);
}
