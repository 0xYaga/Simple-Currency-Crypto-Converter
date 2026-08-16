import { readdir } from "node:fs/promises";
import { resolve, relative, extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set(["dist", "node_modules"]);

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await collectJavaScriptFiles(fullPath));
    } else if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = (await collectJavaScriptFiles(projectRoot)).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
