import type { Express, Request, Response } from "express";
import express from "express";
import type { AppContext } from "../appContext.js";

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "skillhub";
const SERVER_VERSION = "0.1.0";

const SEARCH_SKILLS_TOOL = {
  name: "search_skills",
  description: "搜索 SkillHub 技能库。按关键词匹配技能名称、描述等元数据。省略 query 返回全部技能。",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "搜索关键词（大小写不敏感，子串匹配）"
      }
    }
  }
};

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function handleInitialize(req: JsonRpcRequest) {
  return jsonRpcResult(req.id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
  });
}

function handleToolsList(req: JsonRpcRequest) {
  return jsonRpcResult(req.id, { tools: [SEARCH_SKILLS_TOOL] });
}

function handleToolsCall(req: JsonRpcRequest, context: AppContext) {
  const params = req.params ?? {};
  const toolName = params.name as string | undefined;

  if (toolName !== "search_skills") {
    return jsonRpcError(req.id, -32602, `Unknown tool: ${toolName}`);
  }

  const dataDir = context.bootstrapState().dataDir;
  if (!dataDir) {
    return jsonRpcResult(req.id, {
      content: [{ type: "text", text: JSON.stringify({ error: "data-dir-not-initialized" }) }],
      isError: true
    });
  }

  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const query = typeof args.query === "string" ? args.query : "";

  const skills = context.database().listSkillHubSkills(query).map((skill) => ({
    id: skill.id,
    folderName: skill.folderName,
    skillName: skill.skillName,
    description: skill.description,
    sourceType: skill.sourceType,
    sourceLabel: skill.source?.label ?? null,
    sourceRepoKey: skill.source?.repoKey ?? null,
    libraryRelativePath: skill.libraryRelativePath
  }));

  return jsonRpcResult(req.id, {
    content: [{ type: "text", text: JSON.stringify(skills) }]
  });
}

function handleMcpRequest(body: unknown, context: AppContext): object {
  if (!body || typeof body !== "object" || !("jsonrpc" in body) || (body as JsonRpcRequest).jsonrpc !== "2.0") {
    return jsonRpcError(undefined, -32600, "Invalid JSON-RPC request");
  }

  const req = body as JsonRpcRequest;
  if (typeof req.method !== "string") {
    return jsonRpcError(req.id, -32600, "Missing method");
  }

  switch (req.method) {
    case "initialize":
      return handleInitialize(req);
    case "notifications/initialized":
      return jsonRpcResult(req.id, {});
    case "tools/list":
      return handleToolsList(req);
    case "tools/call":
      return handleToolsCall(req, context);
    default:
      return jsonRpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export function installMcpEndpoint(app: Express, context: AppContext): void {
  app.post("/mcp", express.json(), (request: Request, response: Response) => {
    const result = handleMcpRequest(request.body, context);
    response.json(result);
  });
}
