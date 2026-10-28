// Made-up Claude Code transcripts for the tests, shaped like what the CLI writes to
// ~/.claude/projects. Never anyone's real data. Text a report must never show carries CANARY.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CANARY = "CANARY-5e2b";
const SID = "11111111-1111-4111-8111-111111111111";
let n = 0;

export function assistant({ model, msg, req, ts, usage, content, extra = {}, sid = SID }) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    cwd: `/Users/dev/${CANARY}`,
    sessionId: sid,
    message: {
      id: msg,
      type: "message",
      role: "assistant",
      model,
      content: content ?? [{ type: "text", text: `Done ${CANARY}` }],
      stop_reason: null,
      usage,
    },
    ...(req ? { requestId: req } : {}),
    type: "assistant",
    uuid: `u-${++n}`,
    timestamp: ts,
    ...extra,
  });
}

/** Writes the fixture transcripts under `<config>/projects`; returns what they must add up to. */
export function writeFixtures(config, now = new Date()) {
  const day = (back, hour = 12) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hour).toISOString();
  const dir = path.join(config, "projects", "-Users-dev-app");
  mkdirSync(path.join(dir, SID, "subagents"), { recursive: true });
  const opus = "claude-opus-4-6";
  const big = {
    input_tokens: 1_000_000,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const rows = [
    // One request written as two rows (streamed): counted once, with the larger counts.
    assistant({
      model: opus,
      msg: "m1",
      req: "r1",
      ts: day(0),
      usage: { ...big, output_tokens: 10 },
    }),
    assistant({
      model: opus,
      msg: "m1",
      req: "r1",
      ts: day(0),
      usage: { ...big, output_tokens: 1_000_000 },
    }),
    // Fast, US-only, a web search and 1-hour cache writes, 3 days ago.
    assistant({
      model: "claude-opus-5-5",
      msg: "m2",
      req: "r2",
      ts: day(3),
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_creation: { ephemeral_5m_input_tokens: 500_000, ephemeral_1h_input_tokens: 500_000 },
        server_tool_use: { web_search_requests: 2 },
        speed: "fast",
        inference_geo: "us",
      },
    }),
    // A tool call whose input holds "model" and "usage" keys: never read as the call's.
    assistant({
      model: "claude-haiku-4-5-20251001",
      msg: "m3",
      req: "r3",
      ts: day(20),
      content: [
        {
          type: "tool_use",
          id: "t",
          name: "x",
          input: { model: "evil", usage: { output_tokens: 999999999 }, note: CANARY },
        },
      ],
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    }),
    // Haiku 5.5 with a prompt over 100,000 tokens pays its higher prices.
    assistant({
      model: "claude-haiku-5-5",
      msg: "m4",
      req: "r4",
      ts: day(60),
      usage: { input_tokens: 200_000, output_tokens: 0 },
    }),
    // Not calls: the CLI's own placeholder, a limit error, a progress row nesting a message.
    assistant({ model: "<synthetic>", msg: "m5", req: "r5", ts: day(0), usage: big }),
    assistant({
      model: opus,
      msg: "m6",
      req: "r6",
      ts: day(0),
      usage: big,
      extra: { isApiErrorMessage: true, error: "rate_limit" },
    }),
    JSON.stringify({
      sessionId: SID,
      type: "progress",
      data: { message: { type: "assistant", message: { id: "m7", model: opus, usage: big } } },
      timestamp: day(0),
    }),
    // A model no table prices, and one newer than the table (priced as its family's newest).
    assistant({ model: "some-local-model", msg: "m8", req: "r8", ts: day(100), usage: big }),
    assistant({ model: "claude-sonnet-9", msg: "m9", req: "r9", ts: day(100), usage: big }),
    "not json at all",
    '{"type":"assistant","message":{"usage":{"output_tokens":',
  ];
  writeFileSync(path.join(dir, `${SID}.jsonl`), `${rows.join("\r\n")}\r\n`);
  // A resumed session copies request m1 (counted once) and a subagent adds one call; the file ends mid-line.
  const resumed = assistant({
    model: opus,
    msg: "m1",
    req: "r1",
    ts: day(0),
    usage: big,
    sid: "22222222-2222-4222-8222-222222222222",
  });
  writeFileSync(
    path.join(dir, "22222222-2222-4222-8222-222222222222.jsonl"),
    `${resumed}\n${resumed.slice(0, 80)}`,
  );
  writeFileSync(
    path.join(dir, SID, "subagents", "agent-1.jsonl"),
    `${assistant({ model: "claude-sonnet-4-5-20250929", msg: "m10", req: "r10", ts: day(1), usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } })}\n`,
  );
  writeFileSync(path.join(dir, "notes.txt"), CANARY);
  return {
    calls: 7,
    // m1 opus-4-6: 1M in $5 + 1M out $25 = 30
    // m2 opus-5.5 fast (2x) US (1.1x): (4 + 0.2 + 0.5M*5/1M + 0.5M*8/1M) = 4 + 0.2 + 2.5 + 4 = 10.7, x2.2 = 23.54, + 2 searches 0.02 = 23.56
    // m3 haiku-4.5: 1M in = 1
    // m4 haiku-5.5 over 100K: 0.2M x $0.50 = 0.10, x1.1 US? no (not US) = 0.10
    // m8 unpriced; m9 sonnet newest (5.5): 1M in = 2
    // m10 sonnet-4.5: 3 + 15 = 18
    usd: {
      today: 30,
      last7Days: 30 + 23.56 + 18,
      last30Days: 30 + 23.56 + 18 + 1,
      allTime: 30 + 23.56 + 18 + 1 + 0.1 + 2,
    },
  };
}
