import type { AppConfig, LaunchCommand, SessionEntry, ToolId, ToolStatus } from "../../shared/types.js";

export interface ToolAdapter {
  id: ToolId;
  parserVersion: string;
  sourceFormat: string;
  capabilities: ToolStatus["capabilities"];
  visibleInProjectUi: boolean;
  defaultSessionSources(env?: NodeJS.ProcessEnv): string[];
  skillTarget(projectRoot: string): { supported: boolean; directory: string | null; reason: string | null };
  detect(config: AppConfig): ToolStatus;
  buildNewSessionCommand(config: AppConfig, cwd: string): LaunchCommand;
  buildResumeCommand(config: AppConfig, session: SessionEntry): LaunchCommand;
}
