# ⚡ PokéGO Analyzer

<p align="center">
  <img src="https://img.shields.io/badge/python-3.9+-blue.svg?style=for-the-badge&logo=python&logoColor=white" alt="Python Support" />
  <img src="https://img.shields.io/badge/framework-Flask-lightgrey.svg?style=for-the-badge&logo=flask&logoColor=white" alt="Flask" />
  <img src="https://img.shields.io/badge/database-SQLite-003B57.svg?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/AI-Gemini%20%7C%20OpenAI%20%7C%20Anthropic-orange.svg?style=for-the-badge&logo=google-gemini&logoColor=white" alt="AI Support" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge" alt="License" />
</p>


A professional, local web application for analyzing your Pokémon GO account, managing PvP/Raid candidates, and planning event tactics with a personalized AI coach. Powered by the `PGSStats.json` export from **PGSharp** or `.csv` export from **PokéGenie**.

---


## Updating the running app

After pulling updates, fully stop and restart the app server. Refreshing the browser does
not reload Python code or templates already cached by an older server process. If the
sidebar count is correct but the Pokémon list is empty after an update, restart the server
and reload the page. Collection restore now tolerates older profile markup and displays
loading errors with a retry button.

## Local network access

The Windows launcher explicitly starts the server on `0.0.0.0:6090`, including
when an older `.env` contains `HOST=127.0.0.1`. It opens localhost on the server
PC because first-run setup must run through a loopback connection.

After setup, other devices on the same network can open
`http://YOUR-PC-IP:6090`. For example, if the server PC is `192.168.1.7`, open
[http://192.168.1.7:6090](http://192.168.1.7:6090).
Allow Python/TCP port 6090 through Windows Firewall on Private networks if needed.
`0.0.0.0` is a listening address, not a browser destination.

For a direct start that overrides an existing `.env`:

```powershell
.venv\Scripts\python.exe app.py --host 0.0.0.0
```

without command-line options honors `HOST` and `PORT` from the environment or
`.env`, falling back to `0.0.0.0` and `6090`. `--port` overrides the port.
Debug mode remains disabled. Do not port-forward this development server.

## Appearance and language

The application is English-only, including forms, errors, analysis labels, and AI prompts.
The Polish language switch has been removed; old browser language settings are ignored.
AI cache keys are versioned so older Polish responses are not served as new English analyses.

The entire interface uses a Material-inspired theme with rounded surfaces, accessible color
roles, Roboto typography, and inline Material icons. The dashboard, sign-in, setup, and
trainer-verification screens share the same theme.

Open **Appearance** in the sidebar, even before uploading a file, or **Settings → Appearance**:

- **Color mode:** System (default), Light, or Dark. System follows OS changes live.
- **Team accent:** Automatic (default), Mystic blue, Valor red, or Instinct yellow.
- Automatic reads the signed-in profile's latest PGSharp export, falling back to its latest
  historical export. Missing team data (including PokéGenie-only profiles) defaults to Mystic blue.
- Manual accents override the trainer's team until you select Automatic again.
- Preferences are saved per local profile in SQLite and persist across devices and restarts.
  Choosing an accent does not change the trainer's in-game team.

## History, Pokémon identity, and special forms

### Living Pokédex

Open **Pokédex** in the sidebar to compare your current collection with the national
catalog (#1–#1025). One held Pokémon of any form fills its Pokédex number in **All Pokémon**.
Shiny, Lucky, XXL, XXS, Gmax, Mega, Shadow, Purified, and Hundo each have a separate
checklist. Categories overlap: one Pokémon can fill several entries. Counts within
each row show individual Pokémon held; completion counts distinct Pokédex numbers.

Choose a category and **Owned**, **Missing**, or **Unknown**, search by species or number,
and browse pages of 40 species. Expand an owned species to see held forms. Refresh
or upload a newer collection to update ownership; historical exports do not fill the
living dex. Removing the last held specimen makes that entry missing again.

Size comes from PGSharp's explicit `size`/`sizeName` category (1=XXS, 5=XXL). Unset,
missing, or unsupported size values remain unknown. A missing XXL/XXS entry is not
confirmed if a held specimen's size is unknown. Mega includes currently held Pokémon
with active forms, reported levels, or explicit Mega history; it does not require
remaining actively Mega evolved. Gmax uses the existing confirmed export status.

Mega/Gmax denominators use the bundled named-form asset catalog, extended by any
explicit matching status in your own export. A dash means no catalogued form. This
is not a release calendar: national species and variants may not yet be obtainable,
and the checklist does not determine which species can be traded. Species names
through #1025 follow the [PokeAPI species dataset](https://github.com/PokeAPI/pokeapi/blob/master/data/v2/csv/pokemon_species.csv);
named-form paths come from PokeMiners. No game images are bundled.

### Export history

Open **History** in the sidebar for individual export comparisons, daily,
weekly (ISO weeks), monthly, yearly, and custom date-range reports. Select a session
to see Pokémon added, removed, or changed, plus inventory, currency, and trainer-stat
changes. A session means the interval between two exports, not a recorded play/login
session. Reports use UTC and assign the whole interval to its ending date; intervals
are not split across periods. Date-only range endpoints include the selected day.

Normal full PGSharp JSON uploads now also enter history. Import multiple older exports
in the History screen to backfill dates; duplicates are skipped. One export establishes
a baseline; at least two are needed for a comparison. Existing snapshots are retained.
If older single-user history is unassigned, the screen offers to attach history only
for trainers already verified as yours. PokéGenie CSV is useful for the box but does
not contain the full timestamped account state required for history. Missing Pokémon
means absent from the next export, not proof of a transfer.

The Pokémon list always displays species, Pokédex number, CP, IV, and level. Nicknames
appear separately instead of replacing the species name. Search accepts species,
nickname, or Pokédex number. The **Query Builder** has its own sidebar menu.

**Special Forms** groups Mega evolution, Dynamax, Gigantamax, purified,
costumed, and Shadow Pokémon. Classification uses explicit exported fields, not CP,
IV, or species eligibility. Mega includes active Mega forms, reported levels, and explicit
evolution history. PGSharp levels nested under `pokemonDisplay.megaEvolutionLevel.level`
are supported alongside older scalar fields. Expired temporary-evolution fields do not
by themselves mean the Pokémon is actively Mega evolved.

The box displays clickable **Dmax**, **Gmax**, **Purified**, **Mega**, and **Hatched** tags. Use the
tag checkboxes to match all selected statuses, combined with search and the existing
box filter (for example, Shiny + Purified + Mega). **Clear tags** resets these checkboxes.
Mega tags distinguish active evolution, reported level, and history without a level.
Hatched comes from the explicit PGSharp `hatchedFromEgg` flag. Eggs still waiting to
hatch are excluded from the Pokémon list, and missing origin fields are not inferred.

Expand **Box Analytics** to see the full collection total, Stardust, and counts for
Shiny, Hundo, Nando (all three IVs zero), Shadow, Lucky, Dmax, Gmax, Purified, Mega,
Hatched, Costumed, Favorite, and Event tags. These counts overlap and always describe
the whole collection. The sidebar is reserved for the player profile and navigation.
Gigantamax is also included in Dynamax. Unsupported or omitted export fields cannot
be inferred reliably. The expandable export-details view shows form/status fields
for the two highest-CP hundos of a selected species (#6 for Charizard), without account
details, to help diagnose export versions that encode forms differently. PGSharp's
`pokemonDisplay.breadModeEnum: 1` is recognized as Dynamax, including traded Pokémon;
`breadModeEnum: 2` identifies Gigantamax even when the exported form name remains normal.
Gigantamax appears in both Max categories. `breadModeEnum: 4` remains unclassified;
crowned Zacian/Zamazenta retain their named forms without being labeled Dmax or Gmax.
Other numeric values are not guessed;
explicit Max flags and form names remain supported.

## Game artwork

Artwork and game icons load directly from [PokeMiners](https://github.com/PokeMiners/pogo_assets).
The bundled catalog contains verified filenames only, with form and base-art fallbacks.
Run `python tools/update_pokeminers_catalog.py` to refresh the index without downloading images.
Variant badges use game-inspired colors on a blue backing; Stardust and team emblems retain
their original colors. Missing images show a vector placeholder.

## Inventory and progression

Inventory has one item per row in two columns: Bag and Other owned items. Bag categories
follow PokeMiners Game Master's `ITEM_INVENTORY_UPDATE_SETTINGS`; items within each category
sort by item ID. Unknown items stay visible in Other. Event/GO Pass points, Max Particles,
and Gimmighoul Coins appear with other resources.

The profile uses exported cumulative XP thresholds. Level 80 shows a full bar; missing
thresholds are identified. History charts show period gains/net changes and follow the same
account, date, and period filters as the session table.

## Verification

Run `python -m unittest discover -s tests -v` after installing `requirements.txt`.
The suite covers legacy database migration, profile preference isolation, validation,
automatic team selection, and shared English templates. `node --test tests/test_ui.cjs`
checks system-theme changes, manual overrides, save failures, and PokeMiners artwork
fallbacks. Python tests also cover period/range reporting, profile isolation, automatic
history recording, zero-change intervals, species/form parsing, event-counter labels,
league-specific eligibility, Events ingestion, and inventory grouping.

## 🌟 Key Features

| Tab | Feature Description |
| :--- | :--- |
| 🧑‍💼 **Player Profile** | Beautiful sidebar profile card displaying your username, trainer level, team affiliation (Mystic ❄️, Valor 🔥, Instinct ⚡), PokéCoins, and total Stardust. |
| 🎮 **Pokémon Box** | Visible species, Pokédex number, nickname, CP, IV, and level with searching, sorting, and filters. |
| **History** | Session detail, day/week/month/year summaries, custom ranges, and historical JSON imports. |
| **Special Forms** | Mega, Dynamax, Gigantamax, purified, costumed, and Shadow filters based on exported status. |
| **Query Builder** | Dedicated transfer/search string generator for bulk box management. |
| ⚔️ **Raid Attackers** | PVE attacker ranks utilizing a custom DPS×TDO proxy combined with meta tier list multipliers to identify your top attackers. |
| 🏆 **PvP Analyzer** | Evaluates Great, Ultra, and Master League candidates with **IV Rank** (stat-product, matching PvPoke methodology) and displays detailed badge indicators. |
| 🤖 **PvP Team Builder** | AI-powered 3-pokemon team builder (Lead, Safe Switch, Closer) tailored to your box, analyzing type synergies and meta counters. |
| 📅 **Event Calendar** | Dynamic countdown timers, Pokémon spawn directories, raid boss trackers, and meta tier indicators synced with live events. |
| 🎒 **Items & Inventory** | Complete inventory breakdown with a smart AI analysis showing exactly which items to apply to which Pokémon. |
| 🔧 **Power-Up Planner** | Dedicated dashboard highlighting candidate priorities for evolution, power-ups, purification, and Elite TMs. |
| ⚙️ **Settings Panel** | Switch AI providers, configure API keys, and monitor SQLite response cache hits. |

---

## 🛡️ PvP IV Rank Methodology

Each Pokémon in the PvP tab displays its **stat-product rank** (rank 1 = best possible IV combination for the CP limit):
- **Formula:** $\text{Stat Product} = \text{Effective Atk} \times \text{Effective Def} \times \lfloor\text{Effective HP}\rfloor$ at the highest reachable level under the league CP cap.
- **Bulk Optimization:** Lower Attack IVs are preferred as they allow the Pokémon to reach a higher level, yielding higher defensive stats and total bulk.
- **Ranks and Badges:**
  - 🥇 **Gold Badge** — Rank 1 (Perfect PvP IVs)
  - 🟢 **Green Badge** — Top 1% (Excellent bulk)
  - 🟡 **Yellow Badge** — Top 5% (Very Good)
  - 🔵 **Cyan Badge** — Top 10% (Good)

---

## 📂 Bulk Transfer Query Generator

The search generator bar above the Pokémon table generates queries compatible with the in-game search box:
- Separates terms with `,` (logical OR in Pokémon GO).
- Optional toggles like `&!shiny&!shadow&!lucky&!favorite`, `&!3*&!4*`, `&!legendary`, and `&cp-XXX`.
- **Smart Protection:** Automatically excludes any species where you hold a highly valuable individual (e.g., Shiny, Shadow, Lucky, Hundo, or PvP Rank 1).

---

## 💾 SQLite Caching & Local State

- **Local profile storage:** Exports, profiles, and preferences are stored in `baza_pogo.db` on your server. Optional AI analysis sends the supplied analysis data to your configured provider. Remote fonts, charts, and PokeMiners artwork make browser requests to their respective hosts.
- **Response Cache:** AI responses are cached using a cryptographic hash of the input query (IVs, CP, shininess, level). Identical requests bypass the API and return instantly, saving request tokens.
- **Session Restoration:** Upon page reload, the server automatically reads the last uploaded raw JSON from the database and restores your dashboard.

---

## 📱 Data Sources — PGSharp & PokéGenie

This application works with data exported from two popular third-party tools:

1. **`PGSStats.json`** export file generated by the **PGSharp** app (a modified Pokémon GO client). It contains your complete Pokémon box, item inventory, trainer profile, and battle statistics.
2. **`.csv`** export file generated by the **PokéGenie** app (an IV scanner and overlay). It contains the Pokémon species list, IVs, levels, CP, and move names that you have scanned.

### How to get your `pgsstats.json` (PGSharp):
1. Open **PGSharp** on your device.
2. Open **PGSharp Settings / Options**.
3. Scroll to the very bottom and turn **Export account data** to **ON**.
4. Select a folder on your phone where the `pgsstats.json` file should be automatically saved upon each login.
5. Transfer this `pgsstats.json` file to your computer.
6. Upload the file in the **PokéGO Analyzer** dashboard.

### How to get your `.csv` export (PokéGenie):
1. Open **PokéGenie** on your device.
2. Go to the **My Pokémon** section.
3. Click the menu/options icon and select **Export as CSV**.
4. Transfer and upload this `.csv` file in the **PokéGO Analyzer** dashboard.

> [!NOTE]
> All file parsing and analysis are performed entirely **locally** in your browser and local server — no data is sent to external servers.

---

## 🛠️ Quick Start

### Requirements
- Python 3.9+
- A Google Gemini API Key (obtain a free key at [Google AI Studio](https://aistudio.google.com/apikey)) or access to OpenAI, Anthropic, or Azure OpenAI.

### Installation

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/Predi97/pogo-analyzer.git
   cd pogo-analyzer
   ```

2. **Set up Virtual Environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate        # Windows: venv\Scripts\activate
   ```

3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Open .env and add your GEMINI_API_KEY
   ```

### Execution

```bash
python app.py
```
Open **[http://127.0.0.1:6090](http://127.0.0.1:5000)** in your browser and upload your `PGSStats.json` export to initialize the dashboard.

---

## 🗄️ File Structure

```
pogo-analyzer/
├── app.py                  # Flask application entry point
├── config.py               # Configuration variables & external scrape URLs
├── utils.py                # Formatting and datetime helper utilities
├── database.py             # SQLite WAL-mode connection & caching database
├── state.py                # Global application in-memory state
├── parser.py               # PGSStats.json file parser
├── scoring.py              # Attacker calculations & PvP stat product math
├── data/
│   ├── pokedex.py          # Complete Pokédex (1000+ entries) & items mapping
│   ├── base_stats.py       # Stat formulas, meta ratings, and evolution chains
│   └── cpm.py              # Full CPM table (Levels 1 to 50, incl. half levels)
├── services/
│   ├── ai.py               # AI client initialization & prompt templates
│   ├── events.py           # ScrapedDuck event scrapper
│   └── tiers.py            # Pokebase meta tier list scrapper
├── routes/
│   ├── pokemon.py          # Box upload, CSV export, and status endpoints
│   ├── analysis.py         # Raid & PvP candidate ranking endpoints
│   ├── ai_routes.py        # Custom AI prompt calls & pvp team builder API
│   └── misc.py             # Event, config, and tier configuration routes
├── templates/
│   └── index.html          # Frontend dashboard (HTML + CSS + JS)
├── requirements.txt        # Python package dependencies
└── .env.example            # Environment template file
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
