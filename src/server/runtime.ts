import type http from "node:http";
import { AppContext } from "./appContext.js";
import { createHttpApp } from "./http/app.js";
import type { DirectoryPickResponse } from "../shared/types.js";

export interface HttpServerOptions {
  port: number;
  dev: boolean;
  dataDir: string | null;
  host?: string;
  serveClient?: boolean;
  pickDirectory?: () => DirectoryPickResponse | Promise<DirectoryPickResponse>;
}

export interface RunningHttpServer {
  context: AppContext;
  server: http.Server;
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const host = options.host ?? "127.0.0.1";
  const contextOptions = options.pickDirectory ? { pickDirectory: options.pickDirectory } : {};
  const context = new AppContext(options.dataDir, contextOptions);
  let server: http.Server | null = null;

  try {
    const app = await createHttpApp(context, {
      dev: options.dev,
      ...(options.serveClient === undefined ? {} : { serveClient: options.serveClient })
    });
    server = await listen(app.listen(options.port, host));
  } catch (error) {
    context.close();
    throw error;
  }

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const url = `http://${host}:${port}`;
  process.env.APP_RUNTIME_URL = url;
  const startupTimer = setTimeout(() => context.startBackgroundServices(), 0);
  startupTimer.unref?.();

  let closed = false;
  return {
    context,
    server,
    url,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (closed) {
          resolve();
          return;
        }
        closed = true;
        clearTimeout(startupTimer);
        server.close((error) => {
          context.close();
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

function listen(server: http.Server): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    server.once("listening", onListening);
    server.once("error", onError);
  });
}
