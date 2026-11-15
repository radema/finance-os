# Supplemental browser visual inspection

Synthetic sample, agent-browser 0.43.0 and Chromium 143 on Linux. The image set includes the later Prices, Performance and Goal History fixes; their sample images were refreshed after those changes. Human approval remains pending.

Viewed the full-page 1440 light and dark images for all 18 inventory routes, including content below the fold. Viewed the 1024 and 1920 light and dark boundary images for Overview, Goal detail, Independence, Optimizer, Transactions, Prices, Allocation, Cash flow and Assumptions. Also viewed temporary full-page captures of the other nine routes at 1024 and 1920 in both themes. These checks cover the displayed default states, not every control interaction. Full-page screenshots show only the initial horizontal position of scrollable tables.

The Prices source selects clipped `Manual` at 1024 in both themes. The corrected controls use their intrinsic width; the ordinary viewport image [after the fix](inspection-prices-1024-light-fixed.png) shows the complete selection and date. The six Prices matrix images were refreshed after the change. Wider labels or newly available provider options were not separately tested.

The Goal detail Value label overprints the left axis in full-page captures, as documented in `README.md`: an ordinary viewport resize restores it to the right. Performance's Value is a filled area without a colored line and is named in the legend; its Growth of 100 colored line now has a direct end label, verified inside its SVG at 1024 in an ordinary viewport. The six Performance screenshots were refreshed. The large-value Goal detail fan and range labels were separately verified in the ordinary viewport images linked from `README.md`.

Across the 18 default sample routes, an agent-browser DOM inspection found every rendered `thead th` computed `position: sticky`. The `thead` itself is static. Independence and the default Import tab had no table; The original Goal history captures were empty; the later synthetic sample includes saved and recomputed snapshots. Computed positioning does not establish that every table header remains visible under scrolling, and unpopulated or other tab states were not covered by this check.

The original sample contains a single optimizer mix, so those images do not assess the many-mix scatter. Remaining state and keyboard coverage is recorded in `README.md`. These observations do not replace the required user review.

The populated Goal History chart initially overprinted New car and Home deposit labels ([before](inspection-goal-history-1024-light-before.png)). After the fix, ordinary 1024 viewport bounds put New car at y=413–430, Home deposit at y=431–448 and Retirement at y=452–469, within the chart and in order. The six Goal History sample images were refreshed using the populated synthetic fixture. A rendered test checks a long goal name wraps within the chart.
