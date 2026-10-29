# 05 — Stack for an incremental build

Type: grilling
Status: open
Blocked by: 01
Map: ../map.md

## Question

The source spec proposes Python engine + FastAPI + SQLite + React SPA in one Docker image, and asks about a single-language TypeScript app with the engine in the browser. The user wants simple first, complex only where needed, clean code. Decide: engine language (port of the mock JS engine), API shape, frontend (server-rendered + htmx vs React SPA vs TS app), chart library (ECharts vs Chart.js vs other, given the OE exhibit rules), storage (from 01), packaging. State what the first increment is and what triggers a later upgrade.
