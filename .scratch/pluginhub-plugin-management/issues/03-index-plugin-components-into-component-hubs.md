Status: ready-for-human

# Index imported plugin components into component Hubs

## Parent

.scratch/pluginhub-plugin-management/PRD.md

## What to build

When a source is imported, extract reusable components and register them with the relevant component Hub using source-level identity. Plugin records should reference those component identities. SkillHub integration is required in this slice because it already exists; AgentHub integration should remain an interface boundary until the AgentHub PRD defines its model.

## Acceptance criteria

- [x] Imported skills are registered with SkillHub under the upstream source, not under the plugin name.
- [x] SkillHub skill display paths use source-level identity rather than showing plugin ownership.
- [x] Plugin records reference SkillHub skill IDs instead of copying skill content into PluginHub.
- [x] If multiple source plugins reference the same source component, the component is represented once in the component Hub.
- [x] PluginHub does not add “belongs to plugin” fields to SkillHub skill records.
- [x] The design leaves a typed integration boundary for future AgentHub, McpHub, and HookHub component registration.
- [x] Tests cover source-level skill registration, shared component references, and plugin index references to component IDs.

## Blocked by

- .scratch/pluginhub-plugin-management/issues/02-import-plugin-sources-and-single-plugins.md

## Implementation notes

2026-06-05: 当前 concrete component 支持为 SkillHub skill；Agent/MCP/Hook 保留 typed component boundary，等待对应 Hub/AgentHub PRD 扩展。
