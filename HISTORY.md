# Historical PGSharp snapshots (feature branch)

This extension preserves all existing PokéGO Analyzer endpoints and features.

## Setup
- Set `PGS_EXPORT_DIR` to the directory holding full PGSharp JSON exports (default: `./exports`).
- For app integration, import `attach` from `history_integration` and call `attach(app)` **before** the Flask server begins accepting requests.
- Submit multiple JSON exports to `POST /api/history/upload` under the multipart field `files`, or POST a raw JSON body.
- See `/api/history/dashboard`, `/api/history/accounts`, `/api/history/periods?period=week`, and `/api/history/sessions/<id>`.

Exports are deduplicated using a SHA-256 hash of canonical JSON; the earliest embedded export timestamp per trainer becomes a baseline. A session is a **comparison interval**, not guaranteed continuous gameplay. Empty intervals do not generate sessions. Adding an older export recalculates the entire timeline. Deltas are attached to the later export timestamp; daily/weekly/monthly/yearly reporting reflects observed changes between snapshots, not necessarily the exact times of play.

The source remains local and its JSON snapshots should not be committed to GitHub.

This PR starts with the backend. Material UI, installable PWA, icons, appearance selection, artwork provider settings and chart-oriented frontend are still outstanding.
