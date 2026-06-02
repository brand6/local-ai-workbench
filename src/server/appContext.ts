import crypto from "node:crypto";
import type { AppConfig, BootstrapState } from "../shared/types.js";
import { ensureConfigFiles, normalizeConfig, resolveBootstrapState, writeAppConfig, writeBootstrap } from "./core/bootstrap.js";
import { AppDatabase } from "./storage/database.js";

export class AppContext {
  readonly token = crypto.randomBytes(24).toString("base64url");
  private state: BootstrapState;
  private databaseInstance: AppDatabase | null = null;
  private configInstance: AppConfig | null = null;

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
    const normalized = normalizeConfig(config);
    writeAppConfig(dataDir, normalized);
    this.configInstance = normalized;
    return normalized;
  }

  close(): void {
    this.databaseInstance?.close();
  }

  private initializeDataDir(dataDir: string, persistBootstrap: boolean): void {
    this.databaseInstance?.close();
    this.configInstance = ensureConfigFiles(dataDir);
    this.databaseInstance = new AppDatabase(dataDir);
    if (persistBootstrap && !this.state.overriddenByArg) {
      writeBootstrap(dataDir);
    }
  }
}
