// Prints the one-line commands for this version, each pinned to the release's file and its
// SHA-256, as Markdown for the release notes. Run: node scripts/commands.mjs [--notes]
// The site (shuriken.sh/tools/claude-code-spend) shows the same commands.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const NAME = "claude-code-spend";
const FILE = `${NAME}.mjs`;
const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;
const sha = createHash("sha256")
  .update(readFileSync(path.join(root, FILE)))
  .digest("hex");
const url = `https://github.com/shurikenharness/${NAME}/releases/download/${tag}/${FILE}`;

export const commands = {
  sh: `curl -fsSLo ${FILE} ${url} && openssl dgst -sha256 -r ${FILE} | grep -q ^${sha} && node ${FILE}`,
  ps1: `irm "${url}" -OutFile ${FILE}; if ((Get-FileHash ${FILE}).Hash -eq '${sha}') { node ${FILE} } else { '${FILE} does not match its SHA-256, so it was not run.' }`,
  npx: `npx github:shurikenharness/${NAME}#${tag}`,
};

if (process.argv.includes("--notes")) {
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const section = changelog.split(/^## /m).find((part) => part.startsWith(`[${version}]`)) ?? "";
  process.stdout.write(`${section.split("\n").slice(1).join("\n").trim()}

## Run it

macOS and Linux (downloads ${FILE}, checks its SHA-256, then runs it with Node.js 18 or later):

\`\`\`sh
${commands.sh}
\`\`\`

Windows PowerShell:

\`\`\`powershell
${commands.ps1}
\`\`\`

With npx:

\`\`\`sh
${commands.npx}
\`\`\`

## Checksum (SHA-256)

\`\`\`
${sha}  ${FILE}
\`\`\`
`);
} else process.stdout.write(`${commands.sh}\n\n${commands.ps1}\n\n${commands.npx}\n`);
