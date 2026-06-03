import crypto from "node:crypto";
import type { AppConfig, BootstrapState } from "../shared/types.js";
import { ensureConfigFiles, normalizeConfig, resolveBootstrapState, writeAppConfig, writeBootstrap } from "./core/bootstrap.js";
import { AppEventHub } from "./events/appEvents.js";
import { SessionIndexService } from "./scanning/sessionIndexService.js";
import { AppDatabase } from "./storage/database.js";

export class AppContext {
  readonly token = crypto.randomBytes(24).toString("base64url");
  private readonly events = new AppEventHub();
  private state: BootstrapState;
  private databaseInstance: AppDatabase | null = null;
  private configInstance: AppConfig | null = null;
  private sessionIndexService: SessionIndexService | null = null;
  private backgroundServicesEnabled = false;

  constructor(dataDirArg: string | null) {
    this.state = resolveBootstrapState(dataDirArg);
    if (this.state.dataDir) {
      this.initializeDataDir(this.state.dataDir, false);
    }
  }

  bootstrapState(): BootstrapState {
    return this.state;
  }

  setDataDir(dataDir: string): BootstrapState {
    this.initializeDataDir(dataDir, true);
    this.state = {
      ...this.state,
      initialized: true,
      dataDir
    };
    return this.state;
  }

  database(): AppDatabase {
    if (!this.databaseInstance) {
      throw new Error("Data directory is not initialized");
    }
    return this.databaseInstance;
  }

  config(): AppConfig {
    if (!this.configInstance) {
      throw new Error("Data directory is not initialized");
    }
    return this.configInstance;
  }

  setConfig(config: AppConfig): AppConfig {
    const dataDir = this.state.dataDir;
    if (!dataDir) {
      throw new Error("Data directory is not initialized");
    }
    const normalized = normalizeConfig(config, dataDir);
    writeAppConfig(dataDir, normalized);
    this.configInstance = normalized;
    return normalized;
  }

  eventHub(): AppEventHub {
    return this.events;
  }

  sessionIndexer(): SessionIndexService {
    if (!this.sessionIndexService) {
      throw new Error("Data directory is not initialized");
    }
    return this.sessionIndexService;
  }

  startBackgroundServices(): void {
    if (isTestEnvironment()) return;
    this.backgroundServicesEnabled = true;
    this.sessionIndexService?.start();
  }

  close(): void {
    this.sessionIndexService?.stop();
    this.databaseInstance?.close();
  }

  private initializeDataDir(dataDir: string, persistBootstrap: boolean): void {
    this.sessionIndexService?.stop();
    this.databaseInstance?.close();
    this.configInstance = ensureConfigFiles(dataDir);
    this.databaseInstance = new AppDatabase(dataDir);
    this.sessionIndexService = new SessionIndexService({
      database: () => this.database(),
      config: () => this.config(),
      events: this.events
    });
    if (this.backgroundServicesEnabled) {
      this.sessionIndexService.start();
    }
    if (persistBootstrap && !this.state.overriddenByArg) {
      writeBootstrap(dataDir);
    }
  }
}

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true" || Boolean(process.env.VITEST_POOL_ID);
}
