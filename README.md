# claude-code-spend

What your Claude Code use on this computer would cost at Anthropic's API list prices: today,
the last 7 and 30 days, all time, and by model, on one screen, in a second or two.

It is an **API-equivalent estimate**, not your bill: a Pro or Max plan has a fixed monthly price, so the
number shows how much work went through it, priced as if you had paid per token.

**Several accounts? [Shuriken](https://shuriken.sh) tracks them all → shuriken.sh**

## Run it

You need Node.js 18 or later. Each command downloads one file from this repository's v1.0.0
release, checks its SHA-256, and runs it only when the checksum matches.

macOS and Linux:

```sh
curl -fsSLo claude-code-spend.mjs https://github.com/shurikenharness/claude-code-spend/releases/download/v1.0.0/claude-code-spend.mjs && openssl dgst -sha256 -r claude-code-spend.mjs | grep -q ^b6622addf86963340de95beab21868a6165843290a8e8836d9b63bdfeae812ca && node claude-code-spend.mjs
```

Windows (PowerShell):

```powershell
irm "https://github.com/shurikenharness/claude-code-spend/releases/download/v1.0.0/claude-code-spend.mjs" -OutFile claude-code-spend.mjs; if ((Get-FileHash claude-code-spend.mjs).Hash -eq 'b6622addf86963340de95beab21868a6165843290a8e8836d9b63bdfeae812ca') { node claude-code-spend.mjs } else { 'claude-code-spend.mjs does not match its SHA-256, so it was not run.' }
```

With npx (fetches this repository at the tag; no checksum step):

```sh
npx github:shurikenharness/claude-code-spend#v1.0.0
```

SHA-256 of `claude-code-spend.mjs` v1.0.0: `b6622addf86963340de95beab21868a6165843290a8e8836d9b63bdfeae812ca`

### Read it first

It is one file with no dependencies, so it is quick to read before you run it:

```sh
curl -fsSLo claude-code-spend.mjs https://github.com/shurikenharness/claude-code-spend/releases/download/v1.0.0/claude-code-spend.mjs
openssl dgst -sha256 -r claude-code-spend.mjs     # b6622addf86963340de95beab21868a6165843290a8e8836d9b63bdfeae812ca
less claude-code-spend.mjs
node claude-code-spend.mjs
```

## What it prints

Made-up data from the tests:

```
Claude Code spend on this computer (API-equivalent estimate)
Read 3 transcript files (6 KB) in 0.1 s from ~/.claude

                       Cost    Tokens     Calls
Today               $30.00       2.0M         1
Last 7 days         $71.56       7.0M         3
Last 30 days        $72.56       8.0M         4
All time            $74.66*     10.2M         7

By model, all time                     Cost   Input  Output  Cached    Calls
claude-opus-4-6                     $30.00     1.0M    1.0M       0        1
claude-opus-5-5                     $23.56     1.0M       0    2.0M        1
claude-sonnet-4-5-20250929          $18.00     1.0M    1.0M       0        1
claude-sonnet-9                      $2.00     1.0M       0       0        1
claude-haiku-4-5-20251001            $1.00     1.0M       0       0        1
claude-haiku-5-5                     $0.10     200K       0       0        1
some-local-model                  no price     1.0M       0       0        1
* leaves out calls to models with no public list price.

Prices: Anthropic API list prices as of 2026-10-28, with cache reads and writes, fast mode,
US-only inference and web searches. Not your bill: a Pro or Max plan has a fixed monthly price.
Not in the price table, priced as their family's newest model: claude-sonnet-9.
Several accounts? Shuriken tracks them all → shuriken.sh
```

Options: `--dir PATH` (a Claude Code config folder or its `projects` folder; repeatable), `--json`, `--version`, `--help`.

## What it reads, and what it doesn't

- It reads the transcripts Claude Code writes to `~/.claude/projects/**/*.jsonl` (or every folder in `CLAUDE_CONFIG_DIR`).
- From them it keeps only each model call's model name, token counts (input, output, cache read, 5-minute and 1-hour cache writes), fast mode, US-only inference, web searches and time.
- It prints numbers and model names only: never a prompt, a reply, a file path or a project name.
- It makes **no network calls** and writes nothing (the tests check the source for both). Nothing
  leaves your computer.

One API request is written as several rows (one per content block); rows with the same message id and request id are one call. A resumed session's copied rows are counted once. The CLI's own `<synthetic>` rows, limit errors and progress rows are not calls.

## Prices

Anthropic's API list prices: <https://platform.claude.com/docs/en/about-claude/pricing>. Cache writes cost 1.25x (5 minutes) and 2x (1 hour) the input price, cache reads their listed price, fast mode 2x on the models that have it, US-only inference 1.1x on Claude 4.6 and later, web searches $10 per 1,000. Haiku 5.5 requests with a prompt over 100,000 tokens pay its higher prices. A model newer than the table is priced as its family's newest (the output says so).

The table, its date (`PRICES_AS_OF`) and its sources (`PRICE_SOURCES`) are at the top of
`claude-code-spend.mjs`. A new price is a new release.

## Tests

```sh
npm test
```

They run against made-up logs in `test/fixtures.mjs`, never a real home folder.

## License

MIT, see [LICENSE](LICENSE). Made by [Shuriken](https://shuriken.sh).
