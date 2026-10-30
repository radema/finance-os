# GBI planner

A local, single-user goal-based investing app. It runs on your own computer as a local server on
`127.0.0.1` plus a browser page. Your data stays on your machine.

## Requirements

- Node 24
- pnpm 10.32.1 (pinned by `packageManager` in `package.json`)

## Install

From the repo root:

    pnpm install
    pnpm build
    npm install -g .

`pnpm build` writes the bundle to `dist/`. `npm install -g .` links the repo into the global
`node_modules` and adds the `gbi` command. Keep the repo folder in place and run `pnpm build` again
after each change.

## Run

    gbi

`gbi` starts the server, prints the URL and opens your default browser. Press Ctrl+C to stop it.
The server listens on `127.0.0.1:8716`.

| Variable | Meaning | Default |
|---|---|---|
| `GBI_DATA_DIR` | Folder for the SQLite database (`gbi.sqlite`). Created if missing. | `~/Library/Application Support/gbi/` |
| `GBI_PORT` | TCP port of the server. | `8716` |

## Develop

See `CLAUDE.md` for the commands, the gate and the architecture rules.
