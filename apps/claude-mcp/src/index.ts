import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type ServiceKey = "ui" | "bff" | "agent" | "mcp" | "stack";

const SERVICE_KEYS: ServiceKey[] = ["ui", "bff", "agent", "mcp", "stack"];
const MAX_LINES_PER_SERVICE = 40;
const FRONTEND_PORT = 3010;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const STARTUP_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 800;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const tmpDir = path.join(repoRoot, ".tmp");
const contextPath = path.join(tmpDir, "demo-log-context.txt");

const logsByService: Record<ServiceKey, string[]> = {
  ui: [],
  bff: [],
  agent: [],
  mcp: [],
  stack: [],
};

let demoProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let stdoutCarry = "";
let stderrCarry = "";

const server = new McpServer({
  name: "claude-local-demo-launcher",
  version: "0.0.1",
});

server.registerTool(
  "launch_demo",
  {
    title: "Launch local demo stack",
    description:
      "Starts the local demo stack via npm run dev:full, writes a general runtime log frame to a context file, sets DEMO_CONTEXT_PATH, and opens the frontend URL.",
    inputSchema: z.object({}),
  },
  async () => {
    const preflightErrors = runPreflight();
    if (preflightErrors.length > 0) {
      const message =
        "Preflight failed:\n" + preflightErrors.map((e) => `- ${e}`).join("\n");
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: {
          ok: false,
          url: FRONTEND_URL,
          contextPath,
          message,
        },
      };
    }

    if (demoProcess && !demoProcess.killed) {
      const message = "Demo stack is already running from this MCP server process.";
      return {
        content: [{ type: "text", text: message }],
        structuredContent: {
          ok: true,
          url: FRONTEND_URL,
          contextPath,
          message,
        },
      };
    }

    await fsp.mkdir(tmpDir, { recursive: true });
    clearLogs();
    await writeContextSummary("Starting demo stack...");

    process.env.DEMO_CONTEXT_PATH = contextPath;
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DEMO_CONTEXT_PATH: contextPath,
    };

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCmd, ["run", "dev:full"], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    demoProcess = child;

    stdoutCarry = "";
    stderrCarry = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutCarry = consumeBufferChunk(stdoutCarry, chunk.toString("utf8"), false);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrCarry = consumeBufferChunk(stderrCarry, chunk.toString("utf8"), true);
    });

    child.on("error", async (err) => {
      appendLogLine("stack", `Process error: ${err.message}`);
      await writeContextSummary("Demo stack process failed to launch.");
      demoProcess = null;
    });

    child.on("exit", async (code, signal) => {
      flushCarryBuffers();
      appendLogLine("stack", `Process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      await writeContextSummary("Demo stack process exited.");
      demoProcess = null;
    });

    const ready = await waitForPort(FRONTEND_PORT, STARTUP_TIMEOUT_MS);
    if (!ready) {
      const message =
        `Demo stack started, but frontend was not reachable on ${FRONTEND_URL} ` +
        `within ${Math.floor(STARTUP_TIMEOUT_MS / 1000)}s.`;
      await writeContextSummary(message);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: {
          ok: false,
          url: FRONTEND_URL,
          contextPath,
          message,
        },
      };
    }

    await openBrowser(FRONTEND_URL);
    const message =
      `Demo launched. Using runtime-only log context at ${contextPath}. ` +
      `DEMO_CONTEXT_PATH is set for spawned services.`;
    await writeContextSummary(message);

    return {
      content: [{ type: "text", text: message }],
      structuredContent: {
        ok: true,
        url: FRONTEND_URL,
        contextPath,
        message,
      },
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function runPreflight(): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(path.join(repoRoot, ".env"))) {
    errors.push("Missing root .env file.");
  }

  const requiredCommands = [
    "node",
    process.platform === "win32" ? "npm.cmd" : "npm",
    process.platform === "win32" ? "py" : "python3",
    process.platform === "win32" ? "uv" : "uv",
  ];
  for (const cmd of requiredCommands) {
    if (!hasCommand(cmd)) {
      errors.push(`Missing required command on PATH: ${cmd}`);
    }
  }

  return errors;
}

function hasCommand(command: string): boolean {
  const check = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(check, [command], { stdio: "ignore", shell: process.platform === "win32" });
  if (result.status === 0) return true;
  if (process.platform === "win32") {
    const knownDirs = [
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".cargo", "bin"),
    ];
    const exeName = command.endsWith(".exe") ? command : `${command}.exe`;
    return knownDirs.some((dir) => fs.existsSync(path.join(dir, exeName)));
  }
  return false;
}

function consumeBufferChunk(carry: string, chunk: string, isError: boolean): string {
  const combined = carry + chunk;
  const lines = combined.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const service = detectService(trimmed);
    appendLogLine(service, isError ? `[stderr] ${trimmed}` : trimmed);
  }
  void writeContextSummary();
  return remainder;
}

function flushCarryBuffers() {
  if (stdoutCarry.trim()) {
    appendLogLine(detectService(stdoutCarry), stdoutCarry.trim());
  }
  if (stderrCarry.trim()) {
    appendLogLine(detectService(stderrCarry), `[stderr] ${stderrCarry.trim()}`);
  }
  stdoutCarry = "";
  stderrCarry = "";
}

function detectService(line: string): ServiceKey {
  const match = line.match(/^\[(ui|bff|agent|mcp)\]\s*/i);
  if (!match) return "stack";
  return match[1].toLowerCase() as ServiceKey;
}

function appendLogLine(service: ServiceKey, line: string) {
  const stamp = new Date().toISOString();
  const normalized = line.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  logsByService[service].push(`${stamp} ${normalized}`);
  if (logsByService[service].length > MAX_LINES_PER_SERVICE) {
    logsByService[service] = logsByService[service].slice(-MAX_LINES_PER_SERVICE);
  }
}

function clearLogs() {
  for (const key of SERVICE_KEYS) logsByService[key] = [];
}

async function writeContextSummary(footer?: string) {
  const lines: string[] = [];
  lines.push("General runtime log frame (non-personal context).");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source: npm run dev:full stdout/stderr only`);
  lines.push(`Excluded: ~/.claude/projects/*.jsonl and all user session logs`);
  lines.push("");

  for (const key of SERVICE_KEYS) {
    const entries = logsByService[key];
    if (entries.length === 0) continue;
    lines.push(`## ${key}`);
    for (const entry of entries.slice(-20)) lines.push(`- ${entry}`);
    lines.push("");
  }

  if (footer) {
    lines.push(`Note: ${footer}`);
    lines.push("");
  }

  await fsp.writeFile(contextPath, lines.join(os.EOL), "utf8");
}

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      let resolved = false;

      socket.setTimeout(1500);
      socket.once("connect", () => {
        resolved = true;
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        if (resolved) return;
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(attempt, POLL_INTERVAL_MS);
      });
      socket.once("timeout", () => {
        socket.destroy();
        if (resolved) return;
        if (Date.now() - start >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(attempt, POLL_INTERVAL_MS);
      });
    };
    attempt();
  });
}

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    }
    if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // non-fatal for prototype
  }
}

main().catch((err) => {
  console.error("Failed to start claude-mcp server:", err);
  process.exit(1);
});
