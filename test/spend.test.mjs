// claude-code-spend against made-up transcripts (test/fixtures.mjs), never a real home folder:
// every run gets HOME pointed at a temporary folder and no CLAUDE_* or ANTHROPIC_* variables.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { costOf, priceOf, readCalls, findFiles, summarize } from "../claude-code-spend.mjs";
import { assistant, CANARY, writeFixtures } from "./fixtures.mjs";

const CLI = path.resolve(import.meta.dirname, "../claude-code-spend.mjs");
const ROOT = mkdtempSync(path.join(tmpdir(), "claude-code-spend-"));
const HOME = path.join(ROOT, "home");
const CONFIG = path.join(HOME, ".claude");
let expected;

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env.PATH, HOME, ...env },
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  expected = writeFixtures(CONFIG);
});
after(() => rmSync(ROOT, { recursive: true, force: true }));

const near = (actual, wanted, label) =>
  assert.ok(Math.abs(actual - wanted) < 1e-6, `${label}: ${actual} != ${wanted}`);

describe("reading the transcripts", () => {
  it("counts each request once, and only real model calls", () => {
    const calls = readCalls(findFiles([path.join(CONFIG, "projects")]));
    assert.equal(calls.length, expected.calls);
    const m1 = calls.filter((call) => call.model === "claude-opus-4-6");
    assert.equal(m1.length, 1);
    assert.equal(m1[0].output, 1_000_000);
    assert.ok(!calls.some((call) => call.model === "evil" || call.output === 999999999));
  });

  it("adds up today, 7 days, 30 days and all time at list prices", () => {
    const summary = summarize(readCalls(findFiles([path.join(CONFIG, "projects")])), costOf);
    for (const period of summary.periods) near(period.usd, expected.usd[period.key], period.key);
    const unpriced = summary.models.find((row) => row.model === "some-local-model");
    assert.equal(unpriced.unpriced, 1);
  });
});

describe("prices", () => {
  it("prices fast mode, US-only inference, 1-hour cache writes and web searches", () => {
    const call = {
      model: "claude-opus-5-5",
      input: 1e6,
      output: 1e6,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
      webSearches: 0,
    };
    near(costOf(call), 24, "plain");
    near(costOf({ ...call, fast: true }), 48, "fast");
    near(costOf({ ...call, fast: true, usOnly: true }), 52.8, "fast + US");
    near(costOf({ ...call, input: 0, output: 0, webSearches: 1000 }), 10, "searches");
    near(
      costOf({ ...call, input: 0, output: 0, cacheWrite: 1e6, cacheWrite1h: 1e6 }),
      8,
      "1h writes",
    );
  });

  it("knows every current model, and a newer one by its family", () => {
    for (const model of [
      "claude-fable-5-1",
      "claude-opus-4-8",
      "claude-opus-4-1-20250805",
      "claude-sonnet-5",
      "claude-3-5-haiku-20241022",
      "claude-3-haiku-20240307",
      "claude-3-7-sonnet-20250219",
    ]) {
      assert.ok(priceOf(model) && !priceOf(model).guessed, model);
    }
    assert.equal(priceOf("claude-opus-7").guessed, true);
    assert.equal(priceOf("gpt-5"), null);
  });
});

describe("the command", () => {
  it("prints one screen: periods, models, the estimate note and where several accounts go", () => {
    const result = run([]);
    assert.equal(result.code, 0, result.stderr);
    for (const text of [
      "(API-equivalent estimate)",
      "Today",
      "Last 7 days",
      "Last 30 days",
      "All time",
      "claude-opus-4-6",
      "Several accounts? Shuriken tracks them all → shuriken.sh",
      "as of 2026-10-28",
    ]) {
      assert.ok(result.stdout.includes(text), text);
    }
    assert.ok(result.stdout.split("\n").length <= 30);
    assert.ok(!result.stdout.includes(CANARY));
    assert.ok(result.stdout.includes("$74.66*"), result.stdout);
  });

  it("gives the same numbers as JSON", () => {
    const result = run(["--json"]);
    const json = JSON.parse(result.stdout);
    near(json.periods.allTime.costUsd, expected.usd.allTime, "allTime");
    assert.equal(json.periods.allTime.calls, expected.calls);
    assert.equal(json.estimate, "API-equivalent");
    assert.ok(!result.stdout.includes(CANARY));
  });

  it("reads CLAUDE_CONFIG_DIR and --dir, and says where it looked when there is nothing", () => {
    assert.equal(
      JSON.parse(run(["--json"], { HOME: ROOT, CLAUDE_CONFIG_DIR: CONFIG }).stdout).periods.allTime
        .calls,
      expected.calls,
    );
    assert.equal(
      JSON.parse(run(["--json", "--dir", path.join(CONFIG, "projects")], { HOME: ROOT }).stdout)
        .periods.allTime.calls,
      expected.calls,
    );
    const none = run([], { HOME: path.join(ROOT, "nobody") });
    assert.equal(none.code, 1);
    assert.match(none.stderr, /No Claude Code transcripts found in .*--dir/);
    assert.equal(run(["--nope"]).code, 2);
  });

  it("reads 50 MB of long rows in a couple of seconds", () => {
    const dir = path.join(ROOT, "big", "projects", "p");
    mkdirSync(dir, { recursive: true });
    const text = "lorem ipsum ".repeat(2000);
    for (let file = 0; file < 25; file++) {
      const rows = [];
      for (let i = 0; i < 80; i++) {
        rows.push(
          assistant({
            model: "claude-opus-4-6",
            msg: `m${file}-${i}`,
            req: "r",
            ts: "2026-09-01T10:00:00Z",
            content: [{ type: "text", text }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        );
      }
      writeFileSync(path.join(dir, `${file}.jsonl`), `${rows.join("\n")}\n`);
    }
    const started = Date.now();
    const result = run(["--json", "--dir", path.join(ROOT, "big")]);
    assert.equal(JSON.parse(result.stdout).periods.allTime.calls, 2000);
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  });
});

describe("the source", () => {
  const source = readFileSync(CLI, "utf8");
  it("makes no network calls and starts no programs", () => {
    for (const banned of [
      /from "node:(?:https?|http2|net|tls|dgram|dns|child_process|worker_threads)"/,
      /\bfetch\(/,
      /\bWebSocket\b/,
      /\bXMLHttpRequest\b/,
    ]) {
      assert.doesNotMatch(source, banned);
    }
    const imports = [...source.matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(imports.sort(), ["node:fs", "node:os", "node:path", "node:url"]);
  });

  it("writes no files", () => {
    assert.doesNotMatch(
      source,
      /\b(?:writeFile|appendFile|createWriteStream|mkdir|rm|unlink|rename)(?:Sync)?\(/,
    );
  });
});
