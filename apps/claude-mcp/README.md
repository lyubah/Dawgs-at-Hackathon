# Claude MCP Demo Launcher

Minimal local MCP server for demo use.

## Tool

- `launch_demo`
  - Runs minimal preflight checks.
  - Starts `npm run dev:full`.
  - Captures runtime stdout/stderr logs only (no Claude session logs).
  - Writes log-frame context to `/.tmp/demo-log-context.txt`.
  - Sets `DEMO_CONTEXT_PATH` for spawned services.
  - Opens `http://localhost:3010`.

## Run

From repo root:

```bash
npm run dev:claude-mcp
```
