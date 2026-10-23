# Historical PGSharp snapshots

Open **History** in the sidebar. This screen is available even when no
current collection is loaded. Normal full JSON uploads are recorded automatically;
use the history import controls to add multiple older exports or the current export.

Exports are deduplicated using a SHA-256 hash of canonical JSON. The earliest embedded
export timestamp per verified trainer becomes the baseline. At least two exports are
needed for a session. A session is an export comparison interval, not a recorded login
or continuous gameplay session. New comparisons include zero-change intervals.
Adding an older export recalculates the derived timeline; raw snapshots are retained.

Choose individual sessions, days, ISO weeks, months, or years, with optional inclusive
date filters. Reports use UTC and attribute the entire comparison to its ending date;
they cannot identify the exact times of play or split activity across calendar periods.
Session details show Pokémon added/removed/changed, item deltas, currencies, and player
statistics. Removed Pokémon are absent from the next export, not proven transfers.

History is isolated per signed-in profile. Only exports for a trainer you have verified
can be imported. Legacy single-user snapshots remain preserved; the history screen can
attach eligible history for trainers already linked to your profile. Legacy duplicates
that would conflict with an owned snapshot remain preserved and unassigned. Do not
delete the database to update the application.

PokéGenie CSV does not contain the timestamped full-account state required for history.
If no older full exports or stored snapshots exist, earlier activity cannot be recreated.
The source JSON remains local and should not be committed to GitHub.

## Folder imports and API

- `PGS_EXPORT_DIR` optionally specifies a folder of full PGSharp JSON exports (default
  `./exports`). The existing background importer only accepts verified trainers.
- `POST /api/history/upload`: multipart `files` or one raw JSON export.
- `POST /api/history/import-current`: ingest the signed-in profile's current full export.
- `GET /api/history/report?period=month&start=2026-01-01&end=2026-12-31`: reports; optional
  `account` selects one of the signed-in profile's trainers.
- `GET /api/history/sessions/<id>`: owned session details.
- `POST /api/history/restore-legacy`: attach eligible preserved history for owned trainers.
- Existing `/api/history/dashboard`, `/api/history/accounts`, and
  `/api/history/periods?period=week` endpoints remain available.

The application already calls `history_integration.attach(app)` before serving requests.
