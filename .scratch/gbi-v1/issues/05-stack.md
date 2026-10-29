# 05 — Stack for an incremental build

Type: grilling
Status: claimed
Blocked by: 01
Map: ../map.md

## Question

The source spec proposes Python engine + FastAPI + SQLite + React SPA in one Docker image, and asks about a single-language TypeScript app with the engine in the browser. The user wants simple first, complex only where needed, clean code. Decide: engine language (port of the mock JS engine), API shape, frontend (server-rendered + htmx vs React SPA vs TS app), chart library (ECharts vs Chart.js vs other, given the OE exhibit rules), storage (from 01), packaging. State what the first increment is and what triggers a later upgrade.

Constraint added by the user (2026-10-29): the app must be installable on the user's personal MacBook, with a fitting install mode (e.g. `uv tool install`, a Homebrew formula, a packaged `.app`, Docker Desktop — compare, keep it simple). Data always stays local on the machine and never goes to a cloud service. Decide the install and update path, where the data file lives on macOS, how backup works, and how the monthly job (prices + snapshot) runs without a server.
