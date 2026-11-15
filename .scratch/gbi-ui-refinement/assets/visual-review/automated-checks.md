# Production integration — automated verification

Date: 2026-11-15. Branch: `feat/bauhaus-ui-prototype`. The implementation is an
uncommitted continuation of HEAD `aaf43c0f34f2cc172066d625561b7683f70edfd0`.
The final baseline manifest records exact changed-file hashes; do not review commits alone.

## Results

| Check | Result |
| --- | --- |
| Node / package manager | Node 24.11.1; pinned pnpm 10.32.1 |
| `pnpm lint` | Passed; two informational useTemplate notices in unchanged tests |
| `pnpm typecheck` | Passed |
| Focused UI/Overview/architecture checks | 7 files, 57 tests passed, including the new Motif tests; chart labels/label room: 11 tests passed |
| Final `pnpm gate` | Failed at Vitest: 128 files passed, 2 failed; 1,340 tests passed, 3 failed, 2 skipped |
| `pnpm build` after final code changes | Passed, client and server bundles; existing >500 kB client chunk warning |
| Separate `pnpm audit` | Failed: 7 advisories, 6 moderate and 1 low |
| `git diff --check` | Passed |

Raw execution records: [gate](gate.log), [build](build.log), [audit summary](audit-summary.json).

The final gate failed on optimizer timing checks: full search measured 9,074.36 ms
against 3,000 ms; spend least measured 25,059.21 ms against 10,000 ms (AC-83), and
the O5 optimizer API test exceeded its 5,000 ms timeout (AC-84). An earlier final-candidate
run passed every API test and measured 3,345.41 ms / 11,289.82 ms for the engine speed
checks. A serial diagnostic run also exceeded engine limits (3,693.07 ms / 12,113.39 ms),
while all optimizer API tests passed. Engine/server code and performance limits are
unchanged by this UI integration. Host timing remains a blocker, not a waived check.
The gate short-circuits before build/audit, so those steps were run separately.

The final suite includes the new extreme-value chart regression, which renders actual
ECharts SVG labels and asserts that they remain in bounds and do not overlap. It failed
on the former range-label placement and passes after the fix. Browser checks reproduced
and verified the ordinary-view issue. Narrow shared KPI grids use two columns so the
1,490,859,775.08 EUR fixture amount fits on one line at 1024 px. These presentation fixes
preserve values, plot-grid room, financial calculations and chart encodings.
Additional browser findings corrected source-select truncation on Prices, physical Overview
block spacing, the Growth of 100 direct label, and overlapping/long Goal history labels.
Two new actual-renderer TimeChart regressions pass, including long-name wrapping.

## Audit baseline

No package or lockfile changes are included. Every advisory is reached via
`yahoo-finance2 > @modelcontextprotocol/sdk`. `@hono/node-server` 2.1.5 accounts for
GHSA-qv5m-9pm6-hqp3 and GHSA-jpvv-r467-5p4w. `hono` 4.13.13 accounts for
GHSA-4m76-xfj5-7975, GHSA-h7mg-cq63-vhpq, GHSA-46wx-v44x-9hh2,
GHSA-4h7h-rv7c-7m2v and GHSA-3gg2-335m-rxc6 (the low-severity item).

Local inspection found the app imports Yahoo's default price API and calls `chart`;
there are no MCP SDK/Hono imports in application code. Yahoo exposes separate MCP
server/HTTP exports and a CLI. This indicates an unused transitive server path, not
proof of universal non-exploitability. Clearing the audit requires dependency/lockfile
work outside the authorized visual change. The audit failure remains explicit.

## Scope and limitations

The throwaway variant mount, switcher, variants and stylesheet are removed. Production
uses explicit semantic motif call sites and shared original stylesheets/tokens. All
fonts remain bundled, and no application dependencies, financial calculations, REST
behaviour or chart encodings changed. Goal fan/range label placement was corrected after browser
checks exposed overlap/clipping with a large target; numeric values and plot conventions
remain unchanged. Vitest now discovers `.test.tsx` files as well
as `.test.ts`, so the JSX Motif tests participate in the gate.

Browser evidence is indexed separately in this directory. Human visual acceptance is
pending. Neither a passing focused suite nor browser screenshots make this ready to
merge while the full gate is blocked. The user owns visual approval and merging.
