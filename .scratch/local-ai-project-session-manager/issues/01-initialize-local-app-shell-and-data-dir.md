Status: ready-for-agent

# Initialize local app shell and data directory

## Parent

.scratch/local-ai-project-session-manager/PRD.md

## What to build

Build the first runnable local manager shell: one command starts a localhost backend and serves the Chinese Web UI. On first run, the app asks the user to choose a manager data directory, writes bootstrap configuration, initializes baseline config, and protects local API calls with a transparent startup token.

This slice should produce a demoable empty-state app: the user can start the service, open the page, choose a data directory, restart, and see that the selected data directory is reused.

## Acceptance criteria

- [x] A single local serve command starts the backend and serves the Web UI on `127.0.0.1`.
- [x] First run shows a Chinese setup screen for choosing the manager data directory.
- [x] The selected data directory is persisted through lightweight bootstrap config and can be overridden by a startup data-dir argument.
- [x] The data directory contains initial app config and any required empty storage files/directories.
- [x] The Web UI can call the backend only with the startup-generated local token.
- [x] Restarting the app reuses the existing data directory without asking again.
- [x] The empty-state homepage shows no projects and offers project add/scan entry points.

## Blocked by

None - can start immediately

## Comments

- 2026-06-01：已实现本地 serve 命令、first-run 数据目录设置、bootstrap 配置、启动 token 和中文空状态首页。验证：npm run check、npm test、npm run build、生产 HTTP 冒烟返回 200。
