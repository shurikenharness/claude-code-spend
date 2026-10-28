#!/usr/bin/env node
// claude-code-spend: what your Claude Code use on this computer would cost at Anthropic's API list
// prices. An API-equivalent estimate, not your bill: a Pro or Max plan costs a fixed monthly price.
// Source, releases and checksums: https://github.com/shurikenharness/claude-code-spend
// SPDX-License-Identifier: MIT
//
// It reads the transcripts Claude Code writes to <config>/projects/**/*.jsonl (~/.claude by
// default), and from them only each model call's model name, token counts and time. It never
// reads your prompts or Claude's replies into anything it prints, makes no network calls and
// writes nothing. Several accounts? Shuriken tracks them all: https://shuriken.sh
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NAME = "claude-code-spend";
export const VERSION = "1.0.0";

// ---------------------------------------------------------------------------------------------
// Prices. US dollars per million tokens, Anthropic's list prices on the day below.

export const PRICES_AS_OF = "2026-10-28";
export const PRICE_SOURCES = ["https://platform.claude.com/docs/en/about-claude/pricing"];

/**
 * Most specific first; the first pattern that matches the model id prices it. Cache writes are
 * 1.25x (5 minutes) and 2x (1 hour) the input price. `fast`: fast mode multiplies every price by
 * this. `usOnly`: US-only inference (`inference_geo: "us"`) costs 1.1x (Claude 4.6 and later).
 * `over`: a request whose prompt (input + cache read + cache write) is over `tokens` pays `rates`.
 */
export const PRICES = [
  {
    name: "fable-5.1",
    pattern: /(?:fable|mythos)-5-1(?:$|[^0-9a-z])/,
    rates: r(10, 50, 0.25, 12.5, 20),
    usOnly: true,
  },
  {
    name: "fable-5",
    pattern: /(?:fable|mythos)-5(?:$|[^0-9])/,
    rates: r(10, 50, 1, 12.5, 20),
    usOnly: true,
  },
  {
    name: "opus-5.5",
    pattern: /opus-5-5(?:$|[^0-9a-z])/,
    rates: r(4, 20, 0.2, 5, 8),
    fast: 2,
    usOnly: true,
  },
  {
    name: "opus-5",
    pattern: /opus-5(?:$|[^0-9])/,
    rates: r(5, 25, 0.5, 6.25, 10),
    fast: 2,
    usOnly: true,
  },
  {
    name: "opus-4.8",
    pattern: /opus-4-8(?:$|[^0-9])/,
    rates: r(5, 25, 0.5, 6.25, 10),
    fast: 2,
    usOnly: true,
  },
  {
    name: "opus-4.6",
    pattern: /opus-4-[67](?:$|[^0-9])/,
    rates: r(5, 25, 0.5, 6.25, 10),
    usOnly: true,
  },
  { name: "opus-4.5", pattern: /opus-4-5(?:$|[^0-9])/, rates: r(5, 25, 0.5, 6.25, 10) },
  {
    name: "opus-4",
    pattern: /opus-4(?:-[01])?(?:$|[^0-9])|3-opus/,
    rates: r(15, 75, 1.5, 18.75, 30),
  },
  {
    name: "sonnet-5.5",
    pattern: /sonnet-5-5(?:$|[^0-9a-z])/,
    rates: r(2, 10, 0.1, 2.5, 4),
    usOnly: true,
  },
  { name: "sonnet-5", pattern: /sonnet-5(?:$|[^0-9])/, rates: r(2, 10, 0.2, 2.5, 4), usOnly: true },
  {
    name: "sonnet-4.6",
    pattern: /sonnet-4-6(?:$|[^0-9])/,
    rates: r(3, 15, 0.3, 3.75, 6),
    usOnly: true,
  },
  { name: "sonnet-4", pattern: /sonnet-4|3-[57]-sonnet/, rates: r(3, 15, 0.3, 3.75, 6) },
  {
    name: "haiku-5.5",
    pattern: /haiku-5-5(?:$|[^0-9a-z])/,
    rates: r(0.1, 0.5, 0.01, 0.125, 0.2),
    over: { tokens: 100_000, rates: r(0.5, 2.5, 0.05, 0.625, 1) },
    usOnly: true,
  },
  { name: "haiku-4.5", pattern: /haiku-4-5/, rates: r(1, 5, 0.1, 1.25, 2) },
  { name: "haiku-3.5", pattern: /haiku-3-5|3-5-haiku/, rates: r(0.8, 4, 0.08, 1, 1.6) },
  { name: "haiku-3", pattern: /3-haiku/, rates: r(0.25, 1.25, 0.03, 0.3, 0.5) },
  // A model newer than this table is priced as its family's newest, never left at $0.
  {
    name: "opus-5.5",
    pattern: /opus/,
    rates: r(4, 20, 0.2, 5, 8),
    fast: 2,
    usOnly: true,
    guessed: true,
  },
  {
    name: "sonnet-5.5",
    pattern: /sonnet/,
    rates: r(2, 10, 0.1, 2.5, 4),
    usOnly: true,
    guessed: true,
  },
  {
    name: "haiku-5.5",
    pattern: /haiku/,
    rates: r(0.1, 0.5, 0.01, 0.125, 0.2),
    over: { tokens: 100_000, rates: r(0.5, 2.5, 0.05, 0.625, 1) },
    usOnly: true,
    guessed: true,
  },
  {
    name: "fable-5.1",
    pattern: /fable|mythos/,
    rates: r(10, 50, 0.25, 12.5, 20),
    usOnly: true,
    guessed: true,
  },
];

/** Web search: $10 per 1,000 searches, on top of the tokens. */
export const WEB_SEARCH_USD = 10 / 1000;

function r(input, output, cacheRead, cacheWrite, cacheWrite1h) {
  return { input, output, cacheRead, cacheWrite, cacheWrite1h };
}

const normalize = (model) =>
  model
    .toLowerCase()
    .trim()
    .replace(/^anthropic[/:.]/, "")
    .replace(/\./g, "-");

/** The price row for a model id, or null when no row matches. */
export function priceOf(model) {
  const id = normalize(model);
  return PRICES.find((row) => row.pattern.test(id)) ?? null;
}

/** A call's API-equivalent cost in US dollars, or null when the model has no price. */
export function costOf(call) {
  const row = priceOf(call.model);
  if (!row) return null;
  const prompt = call.input + call.cacheRead + call.cacheWrite;
  const rates = row.over && prompt > row.over.tokens ? row.over.rates : row.rates;
  const scale = (call.fast && row.fast ? row.fast : 1) * (call.usOnly && row.usOnly ? 1.1 : 1);
  const write1h = Math.min(Math.max(call.cacheWrite1h, 0), call.cacheWrite);
  const tokens =
    call.input * rates.input +
    call.output * rates.output +
    call.cacheRead * rates.cacheRead +
    (call.cacheWrite - write1h) * rates.cacheWrite +
    write1h * rates.cacheWrite1h;
  return (tokens * scale) / 1_000_000 + Math.max(0, call.webSearches) * WEB_SEARCH_USD;
}

// ---------------------------------------------------------------------------------------------
// Reading the transcripts.

/** The folders to read: --dir folders, else CLAUDE_CONFIG_DIR's, else ~/.claude and ~/.config/claude. */
export function defaultDirs(env = process.env, home = homedir()) {
  if (env.CLAUDE_CONFIG_DIR)
    return env.CLAUDE_CONFIG_DIR.split(",")
      .map((dir) => dir.trim())
      .filter(Boolean);
  return [path.join(home, ".claude"), path.join(home, ".config", "claude")];
}

/** A config folder's projects folder, or the folder itself when it holds transcripts directly. */
function transcriptRoot(dir) {
  const projects = path.join(dir, "projects");
  return isDir(projects) ? projects : dir;
}

const enc = (text) => Buffer.from(text, "latin1");
const MARK = enc('"type":"assistant"');
const MESSAGE = enc('"message":{');
const USAGE = enc('"usage":{');

/**
 * Reads every model call in the files. One API request is written as several rows (one per
 * content block), so rows with the same message id and request id are one call: the largest of
 * each count, the earliest time. A resumed session copies earlier rows; the same rule counts them
 * once. Rows the CLI writes itself (`<synthetic>`) are not calls.
 */
export function readCalls(files, onProgress) {
  const calls = new Map();
  let unkeyed = 0;
  forEachLine(files, onProgress, (line) => {
    const call = callOf(line);
    if (!call) return;
    const key = call.key ?? `#${unkeyed++}`;
    const seen = calls.get(key);
    if (seen) merge(seen, call);
    else calls.set(key, call);
  });
  return [...calls.values()].map(({ key: _key, ...call }) => call);
}

const COUNTS = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "webSearches"];

/** Two rows of one request: the largest of each count, the earliest time. */
function merge(seen, call) {
  seen.time = Math.min(seen.time, call.time);
  for (const field of COUNTS) seen[field] = Math.max(seen[field], call[field]);
  seen.fast ||= call.fast;
  seen.usOnly ||= call.usOnly;
}

/**
 * One transcript row as a model call, or null. Only fixed parts of the row are read: its type
 * before the message, the message's id and model before its content (so a tool call's input is
 * never read for them), the last usage object, and the request id and time after it.
 */
function callOf(line) {
  if (line.indexOf(MARK) < 0) return null;
  const p = line.indexOf(MESSAGE);
  const q = line.lastIndexOf(USAGE);
  const end = p < 0 || q < p ? -1 : closeBrace(line, q + 8);
  if (end < 0) return null;
  const tail = line.toString("utf8", end + 1, Math.min(line.length, end + 4096));
  // The row's own type (a progress row that nests a message is not a call).
  const type = valueOf(line.toString("utf8", 0, p), '"type":"') || lastValueOf(tail, '"type":"');
  if (type !== "assistant" || tail.includes('"isApiErrorMessage":true')) return null;
  const head = beforeContent(line.toString("utf8", p, Math.min(line.length, p + 600)));
  const model = valueOf(head, '"model":"');
  const time = Date.parse(lastValueOf(tail, '"timestamp":"'));
  const usage = parseJson(line.toString("utf8", q + 8, end + 1));
  if (!model || model === "<synthetic>" || !usage || !Number.isFinite(time)) return null;
  const id = valueOf(head, '"id":"');
  const request = lastValueOf(tail, '"requestId":"');
  return {
    key: id && request ? `${id}:${request}` : null,
    model,
    time,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    cacheWrite1h: count(usage.cache_creation?.ephemeral_1h_input_tokens),
    webSearches: count(usage.server_tool_use?.web_search_requests),
    fast: usage.speed === "fast",
    usOnly: usage.inference_geo === "us",
  };
}

function beforeContent(head) {
  const content = head.indexOf('"content":');
  return content >= 0 ? head.slice(0, content) : head;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The index just past the `}` that closes the `{` at `start` (braces only; usage holds no strings with braces). */
function closeBrace(line, start) {
  let depth = 0;
  for (let i = start; i < line.length; i++) {
    const byte = line[i];
    if (byte === 0x7b) depth++;
    else if (byte === 0x7d && --depth === 0) return i;
  }
  return -1;
}

/** The text after the first `key`, up to the next quote. */
function valueOf(text, key) {
  const i = text.indexOf(key);
  if (i < 0) return "";
  const j = text.indexOf('"', i + key.length);
  return j < 0 ? "" : text.slice(i + key.length, j);
}

/** The text after the last `key`, up to the next quote. */
function lastValueOf(text, key) {
  const i = text.lastIndexOf(key);
  if (i < 0) return "";
  const j = text.indexOf('"', i + key.length);
  return j < 0 ? "" : text.slice(i + key.length, j);
}

const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

// ---------------------------------------------------------------------------------------------
// Shared by claude-code-spend, codex-spend and kimi-spend (the same code in each).

/** Every `*.jsonl` file under the folders, each once. */
export function findFiles(roots, accept = (name) => name.endsWith(".jsonl")) {
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if ((entry.isFile() || entry.isSymbolicLink()) && accept(entry.name, full)) {
        try {
          const stat = statSync(full);
          if (stat.isFile()) found.set(realpathSync(full), stat.size);
        } catch {
          // Gone between the listing and the stat.
        }
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return [...found].map(([file, size]) => ({ file, size }));
}

function isDir(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Calls `visit` with each line of each file as a Buffer (no line end) and the file, reading 4 MB at a time.
 * A line is only turned into text by the visitor, and only the parts it needs.
 */
export function forEachLine(files, onProgress, visit) {
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  let done = 0;
  for (const { file, size } of files) {
    let fd;
    try {
      fd = openSync(file, "r");
    } catch {
      done += size;
      continue;
    }
    try {
      let carry = null;
      for (;;) {
        const read = readSync(fd, chunk, 0, chunk.length, null);
        if (read === 0) break;
        let buffer = chunk.subarray(0, read);
        if (carry) buffer = Buffer.concat([carry, buffer]);
        let start = 0;
        for (let nl = buffer.indexOf(10, start); nl >= 0; nl = buffer.indexOf(10, start)) {
          visit(trimCr(buffer.subarray(start, nl)), file);
          start = nl + 1;
        }
        carry = start < buffer.length ? Buffer.from(buffer.subarray(start)) : null;
        done += read;
        onProgress?.(done);
      }
      if (carry) visit(trimCr(carry), file);
    } finally {
      closeSync(fd);
    }
  }
}

const trimCr = (line) =>
  line.length && line[line.length - 1] === 13 ? line.subarray(0, line.length - 1) : line;

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

/** Calls added up for today, the last 7 and 30 days (calendar days, your time zone), all time, and per model. */
export function summarize(calls, cost, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBack = (days) =>
    new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - days).getTime();
  const periods = [
    { key: "today", label: "Today", since: midnight.getTime() },
    { key: "last7Days", label: "Last 7 days", since: daysBack(6) },
    { key: "last30Days", label: "Last 30 days", since: daysBack(29) },
    { key: "allTime", label: "All time", since: -Infinity },
  ].map((period) => Object.assign(period, empty()));
  const models = new Map();
  let first = Infinity;
  let last = -Infinity;
  for (const call of calls) {
    const usd = cost(call);
    first = Math.min(first, call.time);
    last = Math.max(last, call.time);
    for (const period of periods) if (call.time >= period.since) add(period, call, usd);
    const row = models.get(call.model) ?? { model: call.model, ...empty() };
    add(row, call, usd);
    models.set(call.model, row);
  }
  const byModel = [...models.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);
  return {
    periods,
    models: byModel,
    first: calls.length ? first : null,
    last: calls.length ? last : null,
  };
}

function empty() {
  return {
    calls: 0,
    usd: 0,
    unpriced: 0,
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function add(into, call, usd) {
  into.calls++;
  if (usd === null) into.unpriced++;
  else into.usd += usd;
  for (const field of TOKEN_FIELDS) {
    into[field] += call[field] ?? 0;
    into.tokens += call[field] ?? 0;
  }
}

export const usd = (value) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function short(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e11 ? 0 : 1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}K`;
  return String(value);
}

const pad = (text, width) => (text.length >= width ? text : text + " ".repeat(width - text.length));
const padStart = (text, width) =>
  text.length >= width ? text : " ".repeat(width - text.length) + text;

/** The one-screen summary. */
export function render({ title, summary, read, notes, label = (model) => model }) {
  const out = [];
  out.push(`${title} (API-equivalent estimate)`);
  out.push(read);
  out.push("");
  if (!summary.periods[3].calls) {
    out.push("No usage found.");
  } else {
    out.push(
      `${pad("", 14)}${padStart("Cost", 13)}${padStart("Tokens", 10)}${padStart("Calls", 10)}`,
    );
    for (const period of summary.periods) {
      const cost = usd(period.usd) + (period.unpriced ? "*" : " ");
      out.push(
        `${pad(period.label, 14)}${padStart(cost, 13)}${padStart(short(period.tokens), 10)}${padStart(period.calls.toLocaleString("en-US"), 10)}`,
      );
    }
    out.push("");
    out.push(
      `${pad("By model, all time", 30)}${padStart("Cost", 13)}${padStart("Input", 8)}${padStart("Output", 8)}${padStart("Cached", 8)}${padStart("Calls", 9)}`,
    );
    const shown = summary.models.slice(0, 12);
    for (const row of shown) {
      const cost =
        row.unpriced === row.calls ? "no price " : usd(row.usd) + (row.unpriced ? "*" : " ");
      const name = label(row.model);
      out.push(
        `${pad(name.length > 29 ? `${name.slice(0, 28)}…` : name, 30)}${padStart(cost, 13)}${padStart(short(row.input), 8)}${padStart(short(row.output), 8)}${padStart(short(row.cacheRead + row.cacheWrite), 8)}${padStart(row.calls.toLocaleString("en-US"), 9)}`,
      );
    }
    if (summary.models.length > shown.length)
      out.push(`  and ${summary.models.length - shown.length} more (--json lists them all)`);
    if (summary.models.some((row) => row.unpriced))
      out.push("* leaves out calls to models with no public list price.");
  }
  out.push("");
  for (const note of notes) out.push(note);
  out.push("Several accounts? Shuriken tracks them all → shuriken.sh");
  return `${out.join("\n")}\n`;
}

/** The --json output. */
export function asJson({ summary, files, bytes, extra = {} }) {
  const period = (p) => ({
    costUsd: round(p.usd),
    calls: p.calls,
    unpricedCalls: p.unpriced,
    tokens: pick(p),
  });
  return `${JSON.stringify(
    {
      tool: NAME,
      version: VERSION,
      estimate: "API-equivalent",
      pricesAsOf: PRICES_AS_OF,
      priceSources: PRICE_SOURCES,
      files,
      bytes,
      firstCall: summary.first === null ? null : new Date(summary.first).toISOString(),
      lastCall: summary.last === null ? null : new Date(summary.last).toISOString(),
      periods: Object.fromEntries(summary.periods.map((p) => [p.key, period(p)])),
      models: summary.models.map((m) => ({ model: m.model, ...period(m) })),
      ...extra,
    },
    null,
    2,
  )}\n`;
}

const round = (value) => Math.round(value * 1e6) / 1e6;
const pick = (row) => Object.fromEntries(TOKEN_FIELDS.map((field) => [field, row[field]]));

/** Arguments: --dir PATH (repeatable), --json, --help, --version. */
export function parseArgs(argv, extra = {}) {
  const options = { dirs: [], json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") {
      if (i + 1 >= argv.length) throw new Error("--dir needs a folder.");
      options.dirs.push(argv[++i]);
    } else if (arg.startsWith("--dir=")) options.dirs.push(arg.slice(6));
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (extra[arg]) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      options[extra[arg]] = argv[++i];
    } else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  return options;
}

/** A progress line on stderr while a big folder is read, only in a terminal. */
export function progress(total) {
  if (!process.stderr.isTTY || total < 64 * 1024 * 1024) return { tick() {}, done() {} };
  let shown = -1;
  return {
    tick(done) {
      const pct = Math.floor((100 * done) / total);
      if (pct !== shown) {
        shown = pct;
        process.stderr.write(`\rReading… ${pct}%`);
      }
    },
    done() {
      process.stderr.write("\r            \r");
    },
  };
}

export function mb(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

const tilde = (dir, home = homedir()) =>
  dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;

/** True when this file is the program being run (also through npx's link), not imported. */
export function isMain(url) {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------

const HELP = `${NAME} ${VERSION}: what your Claude Code use on this computer would cost at Anthropic's API list prices.

  npx ${NAME}            today, 7 days, 30 days, all time, and by model
  --dir PATH             read this Claude Code folder (repeatable); default: CLAUDE_CONFIG_DIR,
                         else ~/.claude and ~/.config/claude
  --json                 the same numbers as JSON
  --version, --help

Reads only <folder>/projects/**/*.jsonl on this computer. No network, nothing uploaded.
Prices: Anthropic's list prices as of ${PRICES_AS_OF} (${PRICE_SOURCES[0]}).
`;

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help || options.version) {
    process.stdout.write(options.help ? HELP : `${VERSION}\n`);
    return 0;
  }
  const started = performance.now();
  const dirs = (options.dirs.length ? options.dirs : defaultDirs()).filter(isDir);
  const files = findFiles(dirs.map(transcriptRoot));
  if (!files.length) {
    const looked = (options.dirs.length ? options.dirs : defaultDirs())
      .map((dir) => tilde(dir))
      .join(", ");
    process.stderr.write(
      `No Claude Code transcripts found in ${looked}. Use --dir to point at the folder.\n`,
    );
    return 1;
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const bar = progress(bytes);
  const calls = readCalls(files, bar.tick);
  bar.done();
  const summary = summarize(calls, costOf);
  if (options.json) {
    process.stdout.write(asJson({ summary, files: files.length, bytes }));
    return 0;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const guessed = summary.models
    .filter((row) => priceOf(row.model)?.guessed)
    .map((row) => row.model);
  const notes = [
    `Prices: Anthropic API list prices as of ${PRICES_AS_OF}, with cache reads and writes, fast mode,`,
    "US-only inference and web searches. Not your bill: a Pro or Max plan has a fixed monthly price.",
  ];
  if (guessed.length)
    notes.push(
      `Not in the price table, priced as their family's newest model: ${guessed.join(", ")}.`,
    );
  process.stdout.write(
    render({
      title: "Claude Code spend on this computer",
      summary,
      read: `Read ${files.length.toLocaleString("en-US")} transcript files (${mb(bytes)}) in ${seconds} s from ${dirs.map((dir) => tilde(dir)).join(", ")}`,
      notes,
    }),
  );
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
