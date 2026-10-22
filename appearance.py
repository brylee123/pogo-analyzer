"""Per-profile Material appearance preferences; no shared or client-owned identity."""
import json
from contextlib import closing
from flask import Blueprint, jsonify, request
from auth import current_user_id
from database import get_db

bp = Blueprint("appearance", __name__)
TEAMS = {1: "mystic", 2: "valor", 3: "instinct"}


def init_appearance():
    with closing(get_db()) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS user_appearance(
            user_id INTEGER PRIMARY KEY REFERENCES app_users(id),
            theme TEXT NOT NULL DEFAULT 'system',
            accent TEXT NOT NULL DEFAULT 'auto')""")


def profile_appearance(uid=None):
    result = {"theme": "system", "accent": "auto", "team": "mystic", "authenticated": uid is not None}
    if uid is None:
        return result
    with closing(get_db()) as db:
        prefs = db.execute("SELECT theme,accent FROM user_appearance WHERE user_id=?", (uid,)).fetchone()
        if prefs:
            result.update(dict(prefs))
        row = db.execute("SELECT raw_json FROM user_latest_upload WHERE user_id=?", (uid,)).fetchone()
        if row is None:
            row = db.execute("""SELECT raw_json FROM history_snapshots WHERE user_id=?
                ORDER BY captured_at DESC,id DESC LIMIT 1""", (uid,)).fetchone()
        if row:
            try:
                raw = json.loads(row["raw_json"])
                team = raw.get("account", {}).get("team")
                if raw.get("source") == "pokegenie":
                    team = raw.get("data", {}).get("player", {}).get("team")
                result["team"] = TEAMS.get(team, "mystic")
            except (ValueError, TypeError, AttributeError):
                pass
    return result


@bp.route("/api/appearance", methods=["GET", "PUT"])
def preferences():
    uid = current_user_id()
    if uid is None:
        return jsonify({"error": "Sign in required"}), 401
    if request.method == "PUT":
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or set(data) != {"theme", "accent"}:
            return jsonify({"error": "Provide theme and accent only"}), 400
        if data["theme"] not in ("light", "dark", "system") or data["accent"] not in ("auto", "mystic", "valor", "instinct"):
            return jsonify({"error": "Choose a supported theme and team accent"}), 400
        with closing(get_db()) as db, db:
            db.execute("""INSERT INTO user_appearance(user_id,theme,accent) VALUES(?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,accent=excluded.accent""",
                (uid, data["theme"], data["accent"]))
    return jsonify(profile_appearance(uid))
