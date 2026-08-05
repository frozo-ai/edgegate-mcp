#!/usr/bin/env node
// Regenerates the tool table in README.md from the real registry in src/server.ts.
// The table rotted to 32 rows while 58 tools shipped; generating it keeps the
// public tool count honest. Run via `npm run docs:tools` (wired into prepublishOnly).
//
// ponytail: regex over src/server.ts rather than importing the module — the
// registry is a plain literal, so no TS build or API-key env is needed to read it.
// If the tool list ever stops being a literal, swap this for an import of the array.
import { readFileSync, writeFileSync } from "node:fs";

const SERVER = "src/server.ts";
const README = "README.md";
const START = "<!-- BEGIN GENERATED TOOL TABLE -->";
const END = "<!-- END GENERATED TOOL TABLE -->";

/** Join a TS string built from adjacent "..." + "..." concatenations. */
function joinParts(raw) {
  const parts = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return parts
    .join("")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const src = readFileSync(SERVER, "utf8");

// Each entry: name: "edgegate_x", description: <string or concatenated strings>, then schema:/inputSchema:/handler:
const entryRe =
  /name:\s*"(edgegate_[a-z0-9_]+)",\s*description:\s*([\s\S]*?),\s*(?:schema|inputSchema|handler)\s*:/g;

const tools = [];
for (const m of src.matchAll(entryRe)) {
  tools.push({ name: m[1], description: joinParts(m[2]) });
}

const registered = [...src.matchAll(/name:\s*"(edgegate_[a-z0-9_]+)"/g)].length;

// Fail loud rather than silently publishing an undercount — that undercount is
// exactly the bug this script exists to prevent.
if (tools.length === 0) {
  console.error(`gen-tool-table: parsed 0 tools from ${SERVER} — refusing to write.`);
  process.exit(1);
}
if (tools.length !== registered) {
  console.error(
    `gen-tool-table: parsed ${tools.length} descriptions but ${registered} tools are registered — refusing to write a partial table.`
  );
  process.exit(1);
}

// Escape pipes so descriptions can't break the markdown table.
const rows = tools
  .map((t) => `| \`${t.name}\` | ${t.description.replace(/\|/g, "\\|")} |`)
  .join("\n");

const table = [
  START,
  "",
  `EdgeGate exposes **${tools.length} MCP tools**. This table is generated from \`src/server.ts\` — run \`npm run docs:tools\` after adding a tool.`,
  "",
  "| Tool | Purpose |",
  "|---|---|",
  rows,
  "",
  END,
].join("\n");

const readme = readFileSync(README, "utf8");
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1) {
  console.error(`gen-tool-table: ${README} is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

const next = readme.slice(0, s) + table + readme.slice(e + END.length);
// Keep the prose count in sync with the real number too.
const synced = next.replace(/\b\d+\+? MCP tools\b/g, `${tools.length} MCP tools`);

writeFileSync(README, synced);
console.log(`gen-tool-table: wrote ${tools.length} tools to ${README}`);
