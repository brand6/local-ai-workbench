# Caveman

Built-in PluginHub packaging for `JuliusBrussee/caveman`.

This package is reimported from the upstream Caveman plugin layout and includes:

- Skills: `caveman`, `caveman-commit`, `caveman-review`, `caveman-help`, `caveman-compress`, `caveman-stats`, `cavecrew`
- Agents: `cavecrew-builder`, `cavecrew-investigator`, `cavecrew-reviewer`
- Claude native plugin files: `.claude-plugin/plugin.json`, `commands/`, `src/hooks/`, `src/tools/`, and `src/rules/`
- Assets and the local `caveman-shrink` MCP proxy implementation under `src/mcp-servers/caveman-shrink/`

PluginHub imports skills, agents, and eligible MCP configs as component refs, then installs the package through the native plugin marketplace path for Codex and Claude. Claude hooks stay plugin-native inside `.claude-plugin/plugin.json`; they are not mirrored into HookHub suites.

`caveman-shrink` is bundled as implementation material, not auto-registered as an MCPHub server, because it is a proxy that requires user-specific upstream MCP command arguments.

Source: https://github.com/JuliusBrussee/caveman
