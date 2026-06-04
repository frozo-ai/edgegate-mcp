import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

interface ClientTarget {
  name: string;
  configPath: () => string;
  detect: () => boolean;
  serverBlock: (apiKey: string, apiUrl: string) => Record<string, unknown>;
  writeConfig: (configPath: string, block: Record<string, unknown>) => Promise<void>;
}

async function mergeIntoMcpServers(
  configPath: string,
  block: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(await readFile(configPath, "utf-8"));
    } catch {
      existing = {};
    }
  }
  existing.mcpServers = existing.mcpServers ?? {};
  existing.mcpServers["edgegate"] = block;
  await writeFile(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}

const CLAUDE_CODE: ClientTarget = {
  name: "Claude Code",
  configPath: () => join(homedir(), ".claude.json"),
  detect: () => existsSync(join(homedir(), ".claude.json")),
  serverBlock: (apiKey, apiUrl) => ({
    type: "stdio",
    command: "npx",
    args: ["-y", "edgegate-mcp"],
    env: { EDGEGATE_API_KEY: apiKey, EDGEGATE_API_URL: apiUrl },
  }),
  writeConfig: mergeIntoMcpServers,
};

const CURSOR: ClientTarget = {
  name: "Cursor",
  configPath: () => join(homedir(), ".cursor", "mcp.json"),
  detect: () => existsSync(join(homedir(), ".cursor")),
  serverBlock: (apiKey, apiUrl) => ({
    command: "npx",
    args: ["-y", "edgegate-mcp"],
    env: { EDGEGATE_API_KEY: apiKey, EDGEGATE_API_URL: apiUrl },
  }),
  writeConfig: mergeIntoMcpServers,
};

const CLAUDE_DESKTOP: ClientTarget = {
  name: "Claude Desktop",
  configPath: () => {
    if (platform() === "darwin") {
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      );
    }
    if (platform() === "win32") {
      return join(process.env.APPDATA ?? homedir(), "Claude", "claude_desktop_config.json");
    }
    return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
  },
  detect: () => existsSync(CLAUDE_DESKTOP.configPath()),
  serverBlock: (apiKey, apiUrl) => ({
    command: "npx",
    args: ["-y", "edgegate-mcp"],
    env: { EDGEGATE_API_KEY: apiKey, EDGEGATE_API_URL: apiUrl },
  }),
  writeConfig: mergeIntoMcpServers,
};

const ALL_CLIENTS = [CLAUDE_CODE, CURSOR, CLAUDE_DESKTOP];

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("EdgeGate MCP installer\n");

  const detected = ALL_CLIENTS.filter((c) => c.detect());
  if (detected.length === 0) {
    console.log(
      "No supported MCP clients detected. Supported: Claude Code, Cursor, Claude Desktop.\n" +
        "If one IS installed, write the config manually — see " +
        "https://github.com/frozo-ai/edgegate-mcp#manual-config."
    );
    rl.close();
    process.exit(1);
  }

  console.log("Detected MCP clients:");
  for (let i = 0; i < detected.length; i++) {
    console.log(`  ${i + 1}. ${detected[i].name} (${detected[i].configPath()})`);
  }
  const pick = (await rl.question("\nWhich one(s)? (e.g. 1,2 or 'all'): ")).trim();
  const chosen =
    pick.toLowerCase() === "all"
      ? detected
      : pick
          .split(",")
          .map((s) => Number(s.trim()) - 1)
          .filter((i) => i >= 0 && i < detected.length)
          .map((i) => detected[i]);

  if (chosen.length === 0) {
    console.log("No valid selection.");
    rl.close();
    process.exit(1);
  }

  const apiKey = (
    await rl.question(
      "\nPaste your EdgeGate API key (egk_live_* or egk_test_*) — get one at\n" +
        "  https://edgegate.frozo.ai/workspace/<id>/settings#api-keys\n  > "
    )
  ).trim();
  if (!apiKey.startsWith("egk_")) {
    console.log("That does not look like a valid EdgeGate API key (must start with `egk_`).");
    rl.close();
    process.exit(1);
  }

  const apiUrl =
    (await rl.question("EdgeGate API URL [default https://edgegateapi.frozo.ai]: ")).trim() ||
    "https://edgegateapi.frozo.ai";

  for (const c of chosen) {
    const block = c.serverBlock(apiKey, apiUrl);
    await c.writeConfig(c.configPath(), block);
    console.log(`✓ Wrote ${c.configPath()}`);
  }

  console.log(
    "\nDone. Restart your MCP client so it picks up the new server.\n" +
      "Then try a prompt like:\n" +
      "  > Use the edgegate MCP to list my workspaces."
  );
  rl.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
