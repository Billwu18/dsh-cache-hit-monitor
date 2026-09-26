# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-26

First release.

### Added

- Right-sidebar tab **Cache Hit Monitor**, opened on page load, localised in
  English and Chinese.
- **Hit rate panel** — a 5×7 dot-matrix percentage, the settled request count,
  the last request's rate, the age of that request and a 28-lamp bar against
  the current prompt total.
- **Register bank** — the four disjoint cache buckets (cache read, cache write,
  uncached input, output) with session totals and proportional lamp rows.
- **Reactor core** — one cell per settled request, newest first. Ink is the
  request's cache hit rate, diameter is its size against the heaviest request on
  the board, and the field fades with age. The board draws one cell per recorded
  request and is only ever as tall as the history it holds.
- **Context pressure panel** — pressure tokens against the context window.
- Depth control (4 / 6 / 9 rows) and a clear-history control.
- History survives tab switches, docking changes and remounts: the tab is
  registered with `keepMounted: true`, and a bounded module-level cache restores
  the board if the pane is rebuilt anyway.
- Four verification harnesses under `test/` — wiring, render shape,
  tab-switch persistence and adversarial input robustness.

### Notes

- Output tokens are deliberately excluded from the hit rate: generated tokens
  are never cacheable, so counting them would flatter the number.
- The panel reads only the `tokenUsage` and `contextPressure` session
  projections. It makes no network requests and stores nothing outside the
  browser tab.

[1.0.0]: https://github.com/Billwu18/dsh-cache-hit-monitor/releases/tag/v1.0.0
