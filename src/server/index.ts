import { AppContext } from "./appContext.js";
import { createHttpApp } from "./http/app.js";

interface CliArgs {
  port: number;
  dev: boolean;
  dataDir: string | null;
}

const args = parseArgs(process.argv.slice(2));
const context = new AppContext(args.dataDir);
const app = await createHttpApp(context, { dev: args.dev });

const server = app.listen(args.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${args.port}`;
  console.log(`Local AI project manager listening on ${url}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${args.port} is already in use. Restart with --port <port>.`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

function shutdown(): void {
  server.close(() => {
    context.close();
    process.exit(0);
  });
}

function parseArgs(argv: string[]): CliArgs {
  let port = 3987;
  let dev = false;
  let dataDir: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dev") {
      dev = true;
    } else if (arg === "--port") {
      const value = argv[index + 1];
      if (!value) throw new Error("--port requires a value");
      port = Number(value);
      index += 1;
    } else if (arg === "--data-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--data-dir requires a value");
      dataDir = value;
      index += 1;
    }
  }

  return { port, dev, dataDir };
}
