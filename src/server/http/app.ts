import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { installApi } from "./api.js";
import type { AppContext } from "../appContext.js";

export interface CreateServerOptions {
  dev: boolean;
  serveClient?: boolean;
}

export async function createHttpApp(context: AppContext, options: CreateServerOptions) {
  const app = express();
  installApi(app, context);

  if (options.serveClient === false) {
    return app;
  }

  if (options.dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "custom"
    });
    app.use(vite.middlewares);
    app.use((request, response, next) => {
      serveDevIndex(vite, request.originalUrl, context.token)
        .then((html) => response.status(200).set({ "Content-Type": "text/html" }).end(html))
        .catch(next);
    });
    return app;
  }

  const clientDir = resolveClientDir(path.dirname(fileURLToPath(import.meta.url)));
  app.use(express.static(clientDir, { index: false }));
  app.use((_request, response) => {
    const html = fs.readFileSync(path.join(clientDir, "index.html"), "utf8");
    response.status(200).set({ "Content-Type": "text/html" }).end(injectToken(html, context.token));
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

async function serveDevIndex(vite: ViteDevServer, url: string, token: string): Promise<string> {
  const template = fs.readFileSync(path.resolve("index.html"), "utf8");
  return vite.transformIndexHtml(url, injectToken(template, token));
}

function injectToken(html: string, token: string): string {
  const script = `<script>window.__LOCAL_API_TOKEN__ = ${JSON.stringify(token)};</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${script}\n</head>`) : `${script}\n${html}`;
}
