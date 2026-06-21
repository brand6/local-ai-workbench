import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";
import type { AppContext } from "../appContext.js";

const LOG_DIR_NAME = "logs";
const LOG_FILE_NAME = "api-response-times.ndjson";
const SLOW_REQUEST_THRESHOLD_MS = 300;
const ERROR_STATUS_CODE = 400;
const ensuredLogDirs = new Set<string>();

interface ApiTimingLogEntry {
  timestamp: string;
  type: "api-response-time";
  system: string;
  method: string;
  path: string;
  queryKeys: string[];
  statusCode: number;
  durationMs: number;
  slow: boolean;
  requestBytes: number | null;
  responseBytes: number | null;
}

export function apiTimingMiddleware(context: AppContext) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === "/events") {
      next();
      return;
    }

    const startedAt = performance.now();
    response.once("finish", () => {
      const durationMs = roundedDuration(performance.now() - startedAt);
      const entry: ApiTimingLogEntry = {
        timestamp: new Date().toISOString(),
        type: "api-response-time",
        system: apiSystemFromPath(request.path),
        method: request.method,
        path: request.path,
        queryKeys: Object.keys(request.query).sort(),
        statusCode: response.statusCode,
        durationMs,
        slow: durationMs >= SLOW_REQUEST_THRESHOLD_MS,
        requestBytes: headerNumber(request.get("content-length")),
        responseBytes: headerNumber(response.getHeader("content-length"))
      };

      if (!isUsefulApiTimingEntry(entry)) return;

      writeApiTimingLog(context.bootstrapState().dataDir, entry);
    });

    next();
  };
}

export function apiTimingLogPath(dataDir: string): string {
  return path.join(dataDir, LOG_DIR_NAME, LOG_FILE_NAME);
}

function writeApiTimingLog(dataDir: string | null, entry: ApiTimingLogEntry): void {
  if (!dataDir) return;
  const logDir = path.join(dataDir, LOG_DIR_NAME);
  try {
    if (!ensuredLogDirs.has(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      ensuredLogDirs.add(logDir);
    }
    fs.appendFile(apiTimingLogPath(dataDir), `${JSON.stringify(entry)}\n`, "utf8", (error) => {
      if (error && !isTestEnvironment()) console.warn("[api-timing] failed to append timing log", error);
    });
  } catch (error) {
    if (!isTestEnvironment()) console.warn("[api-timing] failed to prepare timing log", error);
  }
}

function isUsefulApiTimingEntry(entry: ApiTimingLogEntry): boolean {
  return entry.slow || entry.statusCode >= ERROR_STATUS_CODE;
}

function apiSystemFromPath(requestPath: string): string {
  const [, first, second] = requestPath.split("/");
  if (first === "api") return second || "api";
  return first || "api";
}

function roundedDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

function headerNumber(value: string | string[] | number | undefined): number | null {
  if (Array.isArray(value)) return headerNumber(value[0]);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true" || Boolean(process.env.VITEST_POOL_ID);
}
