# Changelog

Every release is a tag `vX.Y.Z` with `claude-code-spend.mjs` and `SHA256SUMS` attached.

## [1.0.0] - 2026-10-28

First release.

- Reads the transcripts Claude Code writes to `~/.claude/projects/**/*.jsonl` (or every folder in `CLAUDE_CONFIG_DIR`) on this computer and prints what the same tokens would cost at
  Anthropic's API list prices: today, the last 7 and 30 days, all time, and by model.
- Prices as of 2026-10-28, with their sources in the file (`PRICES_AS_OF`, `PRICE_SOURCES`).
- `--json` for the same numbers as JSON. No network calls, nothing written, no dependencies.
