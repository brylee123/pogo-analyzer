import hashlib
import json
import logging
import sqlite3
from typing import Optional

import config
from utils import _now_iso

log = logging.getLogger(__name__)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS ai_cache (
            hash        TEXT PRIMARY KEY,
            label       TEXT,
            response    TEXT NOT NULL,
            model       TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tier_list (
            pokemon_name TEXT,
            tier         TEXT,
            category     TEXT,
            scraped_at   TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (pokemon_name, category)
        );

        CREATE TABLE IF NOT EXISTS events (
            id          TEXT PRIMARY KEY,
            name        TEXT,
            start_time  TEXT,
            end_time    TEXT,
            event_type  TEXT,
            raw_json    TEXT,
            fetched_at  TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS event_strategies (
            event_id     TEXT,
            account_hash TEXT,
            strategy     TEXT NOT NULL,
            created_at   TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (event_id, account_hash)
        );

        CREATE TABLE IF NOT EXISTS scrape_log (
            source      TEXT PRIMARY KEY,
            last_ok     TEXT,
            last_err    TEXT
        );

        CREATE TABLE IF NOT EXISTS last_upload (
            id       INTEGER PRIMARY KEY CHECK(id=1),
            raw_json TEXT NOT NULL,
            saved_at TEXT DEFAULT (datetime('now'))
        );
        """)
    log.info("DB ready: %s", config.DB_PATH)


# ── AI response cache ─────────────────────────────────────────────────────────

def make_hash(*parts) -> str:
    payload = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:20]


def get_cache(h: str) -> Optional[str]:
    with get_db() as db:
        row = db.execute("SELECT response FROM ai_cache WHERE hash=?", (h,)).fetchone()
    return row["response"] if row else None


def set_cache(h: str, label: str, response: str) -> None:
    with get_db() as db:
        db.execute(
            "INSERT OR REPLACE INTO ai_cache (hash, label, response, model) VALUES (?,?,?,?)",
            (h, label[:120], response, config.AI_PROVIDER),
        )


# ── State persistence ─────────────────────────────────────────────────────────

def load_user_state(user_id):
    """Load only this signed-in user's latest snapshot into request-local state."""
    from parser import parse_pgo_json
    from state import _state
    with get_db() as db:
        row=db.execute("SELECT raw_json FROM user_latest_upload WHERE user_id=?",(user_id,)).fetchone()
    if row is None:
        return
    raw=json.loads(row["raw_json"])
    parsed=raw["data"] if raw.get("source")=="pokegenie" else parse_pgo_json(raw)
    _state["pokemons"]=parsed["pokemons"]
    _state["items"]=parsed["items"]
    _state["player"]=parsed.get("player")
    _state["pvp_stats"]=parsed.get("pvp_stats")
    _state["loaded"]=True

def save_upload(raw):
    """Save latest uploaded analyzer state for the current authenticated user."""
    from auth import current_user_id
    uid=current_user_id()
    if uid is None:raise PermissionError("Login required")
    account=raw.get("account",{}).get("name") if isinstance(raw,dict) else None
    with get_db() as db:
        if account:
            owner=db.execute("SELECT user_id FROM trainer_ownership WHERE trainer=?",(account,)).fetchone()
            if owner and owner["user_id"]!=uid:raise PermissionError("Trainer profile belongs to a different user")
            db.execute("INSERT OR IGNORE INTO trainer_ownership(trainer,user_id) VALUES(?,?)",(account,uid))
        db.execute("""INSERT INTO user_latest_upload(user_id,raw_json,saved_at) VALUES(?,?,?)
                      ON CONFLICT(user_id) DO UPDATE SET raw_json=excluded.raw_json,saved_at=excluded.saved_at""",
                      (uid,json.dumps(raw),_now_iso()))
