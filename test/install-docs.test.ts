import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string; bin: Record<string, string> };
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("npm installer documentation", () => {
  it("selects the package that provides the installer executable", () => {
    const command = `npx --package=${packageJson.name}@${packageJson.version} edgegate-mcp-install`;

    expect(packageJson.bin["edgegate-mcp-install"]).toBe(
      "./bin/edgegate-mcp-install",
    );
    expect(readme).toContain(command);
    expect(readme).not.toContain("npx edgegate-mcp-install");
  });
});
