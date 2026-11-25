# Import, optimizer and pension workflow review

These checks used `agent-browser` 0.43.0 and Chromium 143 against a dedicated clone of the synthetic sample database (`/tmp/gbi-workflows`, API 8724, Vite 8725). Changes and the synthetic import stayed in that clone. The authoritative working-tree identity is [source-baseline.json](source-baseline.json); no production source was edited for these checks.

## Import

Uploaded a two-row synthetic CSV via FilePicker. Its name appeared alongside the picker; mapping manually associated `trade_date` with Date, while the other columns were auto-guessed. The row check reported insufficient bucket funding for one buy and an unknown product for the other, with import disabled for zero ready rows. Saved the mapping, then uploaded a separate one-row synthetic sell. The saved mapping was selected automatically, the row was ready, and import succeeded; Past imports showed one active imported row. Evidence: [mapping and row check](import-1280-light-mapping-row-check.png), [past import](import-1280-light-past-import.png).

In Current portfolio, opened Change for the deposit account, switched between weights and units, entered 900 and 600 units for two buckets, and confirmed the 1,500-unit split in the form. The portfolio itself was not saved. [Split editor](import-1280-light-portfolio-split.png). All eight import tabs were visited. Collapse controls on alternate tabs changed and restored their expanded state, including the loaded Current portfolio cards; raw observations: [alternate tabs](workflows-import-collapses.json), [portfolio cards](workflows-portfolio-collapses.json).

## Optimizer

The one-product sample produced the one-mix sentence. Opened the suggested contribution-weight action's confirmation and cancelled it. Added a second product, exercised the default criterion plus Protect the bad case, Maximise the chance and Spend least, and switched to Rebalance now. The two-product result showed 11 candidate mixes, a scatter chart and distinct Current mix and Suggested mix labels. Evidence: [confirmation](optimizer-1280-light-confirm.png), [many mixes](optimizer-1280-light-many-mixes.png). The action was not applied. This checks representative configurations, not every combination of bucket, limit, product universe and criterion.

## Pension

The sample initially showed remaining annual deduction capacity. Saved a €12,000 synthetic annual voluntary schedule in the isolated database, then recorded a €10,000 synthetic voluntary pension contribution. The resulting screen displayed €11,450 used, €0 available and a non-deductible-payment notice, with the schedule and chart rendered: [cap exceeded](pension-1280-light-cap-exceeded.png). The earlier [schedule case](pension-1280-light-excess.png) shows the raised voluntary schedule before that transaction. In this populated form the controls were editable, Save was enabled, and no input or select had `readonly` or `disabled`; no unsupported pension control state was invented. Setup Allocation displayed the Retirement pension weights as read-only text with no editable weight inputs, and directed changes to Pension. These are presentation and interaction observations, not a separate tax-calculation audit.

## Related Overview recheck

Following the Overview spacing correction, all six sample light/dark captures at 1024, 1440 and 1920 were replaced. In every case the measured Goals bottom to Plan top distance was 48 px, and document width matched viewport width. [Raw results](matrix-overview-recapture.json).

## Cash-movement confirmation

Created a €123 synthetic contribution in the isolated workflow database. Its Delete action exposed “Delete cash movement” and Cancel; Cancel closed the confirmation and left the row present. [Confirmation screenshot](transactions-1280-light-cash-delete-confirm.png).
