#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  website: { type: "string" }, check: { type: "boolean" }, "skip-build": { type: "boolean" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("npm run sync:website -- --website <tanziro-website checkout> [--check | --skip-build]\nOr set LOFT_WEBSITE_DIR. Uses the website's canonical loft:update command; does not commit, push or deploy.");
  process.exit(0);
}
if (values.check && values["skip-build"]) throw new Error("Choose --check or --skip-build, not both.");
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = values.website || process.env.LOFT_WEBSITE_DIR;
if (!target) throw new Error("Pass --website <tanziro-website checkout> or set LOFT_WEBSITE_DIR.");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
if (!/(?:github\.com[/:])tanzir71\/loft(?:\.git)?$/.test(git(source, "config", "--get", "remote.origin.url"))) throw new Error("Run from the canonical tanzir71/loft checkout.");
const website = git(path.resolve(target), "rev-parse", "--show-toplevel");
if (!/(?:github\.com[/:])tanzir71\/tanziro-website(?:\.git)?$/.test(git(website, "config", "--get", "remote.origin.url"))) throw new Error("The destination must be the canonical tanzir71/tanziro-website checkout.");
if (!existsSync(path.join(website, "scripts/update-loft.mjs"))) throw new Error("Update the website checkout to a version with loft:update first.");
if (git(source, "status", "--porcelain")) throw new Error("Commit Loft source changes before synchronizing the website.");
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error("Run through npm run sync:website.");
const args = [npmCli, "run", "loft:update", "--", "--source", source];
if (values.check) args.push("--check");
if (values["skip-build"]) args.push("--skip-build");
execFileSync(process.execPath, args, { cwd: website, stdio: "inherit", windowsHide: true });
