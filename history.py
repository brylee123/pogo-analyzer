"""Historical full-export storage and chronologically rebuilt Pokémon GO sessions."""
import hashlib
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock, Thread
from time import sleep
from database import get_db

LOCK = RLock()
WATCH_DIR = Path(os.getenv("PGS_EXPORT_DIR", "exports")).resolve()
def current_watch_dir():
    with get_db() as db:
        try:
            row=db.execute("SELECT value FROM app_settings WHERE key='watch_directory'").fetchone()
            if row:return Path(row["value"])
        except sqlite3.OperationalError:pass
    return WATCH_DIR
MAX_BYTES = int(os.getenv("PGS_MAX_UPLOAD_MB", "80")) * 1024 * 1024

def init_history():
    # DDL and data copies must roll back together (executescript commits implicitly).
    with LOCK, closing(get_db()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        schemas = {
            "history_snapshots": """id INTEGER PRIMARY KEY,
                user_id INTEGER REFERENCES app_users(id), account TEXT NOT NULL,
                captured_at TEXT NOT NULL, hash TEXT NOT NULL,
                source TEXT NOT NULL, raw_json TEXT NOT NULL""",
            "history_sessions": """id INTEGER PRIMARY KEY,
                user_id INTEGER REFERENCES app_users(id), account TEXT NOT NULL,
                from_id INTEGER NOT NULL, to_id INTEGER NOT NULL UNIQUE,
                started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
                changes_json TEXT NOT NULL, totals_json TEXT NOT NULL""",
        }
        for table, definition in schemas.items():
            columns = [row["name"] for row in db.execute(f"PRAGMA table_info({table})")]
            if columns and "user_id" not in columns:
                # Rebuild rather than ALTER: the old snapshot hash UNIQUE constraint
                # must become per-user. IDs, payloads and session links stay intact.
                temporary = table + "_migration"
                db.execute(f"CREATE TABLE {temporary}({definition})")
                names = ",".join(columns)
                db.execute(f"INSERT INTO {temporary}({names}) SELECT {names} FROM {table}")
                db.execute(f"DROP TABLE {table}")
                db.execute(f"ALTER TABLE {temporary} RENAME TO {table}")
            else:
                db.execute(f"CREATE TABLE IF NOT EXISTS {table}({definition})")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_history_user_hash ON history_snapshots(user_id,hash)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_history_account_time ON history_snapshots(account,captured_at,id)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_sessions_account_time ON history_sessions(account,ended_at)")
        # NULL means preserved, unassigned legacy history. Never guess its owner.

def claim_legacy_history(db, account, uid):
    """Attach preserved history only after a successful trainer verification."""
    owner = db.execute("SELECT user_id FROM trainer_ownership WHERE trainer=?", (account,)).fetchone()
    if owner is None or owner["user_id"] != uid:
        raise PermissionError("Verify this trainer before claiming history")
    # A previously reimported snapshot may already exist for this user. Keep the
    # legacy row unassigned in that case, preserving its original session links.
    db.execute("""UPDATE history_snapshots SET user_id=?
        WHERE user_id IS NULL AND account = ? COLLATE NOCASE
        AND NOT EXISTS (SELECT 1 FROM history_snapshots AS owned
                        WHERE owned.user_id=? AND owned.hash=history_snapshots.hash)""",
        (uid, account, uid))
    db.execute("""UPDATE history_sessions SET user_id=?
        WHERE user_id IS NULL AND account = ? COLLATE NOCASE
        AND EXISTS (SELECT 1 FROM history_snapshots s WHERE s.id=from_id AND s.user_id=?)
        AND EXISTS (SELECT 1 FROM history_snapshots s WHERE s.id=to_id AND s.user_id=?)""",
        (uid, account, uid, uid))

def export_time(raw):
    from datetime import timedelta
    value = raw.get("time")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / (1000 if value > 100000000000 else 1), timezone.utc).isoformat()
    if isinstance(value, str):
        import re
        match = re.match(r"^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\s*(EDT|EST|UTC|GMT))?", value.strip())
        if match:
            zone = {"EDT":-4, "EST":-5, "UTC":0, "GMT":0}
            offset = timezone(timedelta(hours=zone.get(match.group(3), 0)))
            return datetime.fromisoformat(match.group(1)+"T"+match.group(2)).replace(tzinfo=offset).astimezone(timezone.utc).isoformat()
    raise ValueError("Export is missing a supported 'time' timestamp; cannot safely backfill")

def verify(raw):
    if not isinstance(raw, dict) or not all(k in raw for k in ("account","player","pokemons","items")):
        raise ValueError("Not a complete PGSharp export")
    if not isinstance(raw["pokemons"], list) or not isinstance(raw["items"], list):
        raise ValueError("Invalid Pokémon or item collections")
    name = raw["account"].get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Missing trainer name")
    ids = [str(p.get("id")) for p in raw["pokemons"] if isinstance(p, dict)]
    if len(ids) != len(raw["pokemons"]) or len(set(ids)) != len(ids) or "None" in ids:
        raise ValueError("Missing or repeated Pokémon instance IDs")
    return name, export_time(raw)

def pokemon_summary(p):
    display = p.get("pokemonDisplay") or {}
    return {"id":str(p["id"]), "species":p.get("pokemonId"),"form":display.get("formName"),
            "cp":p.get("cp"),"iv":[p.get("individualAttack"),p.get("individualDefense"),p.get("individualStamina")],
            "shiny":bool(display.get("shiny")),"lucky":bool(p.get("isLucky")),"favorite":bool(p.get("favorite")),
            "nickname":p.get("nickname"),"moves":[p.get("move1"),p.get("move2"),p.get("move3")]}

def difference(a,b):
    prev = {str(p["id"]):pokemon_summary(p) for p in a["pokemons"]}
    curr = {str(p["id"]):pokemon_summary(p) for p in b["pokemons"]}
    added = [curr[k] for k in sorted(curr.keys()-prev.keys())]
    removed = [prev[k] for k in sorted(prev.keys()-curr.keys())]
    modified = [{"pokemon":curr[k],"before":prev[k]} for k in sorted(prev.keys()&curr.keys()) if curr[k]!=prev[k]]
    def items(x):
        return {str(p.get("item")):int(p.get("count") or 0) for p in x["items"]}
    ia,ib=items(a),items(b)
    item_delta={k:ib.get(k,0)-ia.get(k,0) for k in sorted(ia.keys()|ib.keys()) if ib.get(k,0)!=ia.get(k,0)}
    def currency(x):
        return {c.get("currencyType"):int(c.get("quantity") or 0) for c in x["account"].get("currencyBalance",[])}
    ca,cb=currency(a),currency(b)
    money={k:cb.get(k,0)-ca.get(k,0) for k in sorted(ca.keys()|cb.keys()) if cb.get(k,0)!=ca.get(k,0)}
    stats={}
    for k,v in b["player"].items():
        old=a["player"].get(k)
        if type(v) in (float,int) and type(old) in (float,int) and v!=old:stats[k]=v-old
    changes={"added":added,"removed":removed,"modified":modified,"items":item_delta,"currencies":money,"stats":stats}
    totals={"acquired":len(added),"removed":len(removed),"modified":len(modified),
            "shinies":sum(p["shiny"] for p in added),
            "hundos":sum(p["iv"]==[15,15,15] for p in added),
            "items_gained":sum(max(0,n) for n in item_delta.values()),
            "items_spent":sum(max(0,-n) for n in item_delta.values()),
            "caught":stats.get("numPokemonCaptured",0),
            "xp":stats.get("experience",0),
            "distance_km":stats.get("kmWalked",0),
            "stardust":money.get("STARDUST",0),
            "coins":money.get("POKECOIN",0)}
    return changes,totals,bool(added or removed or modified or item_delta or money or stats)

def rebuild(db,account,uid):
    rows=db.execute("SELECT * FROM history_snapshots WHERE user_id=? AND account=? ORDER BY captured_at,id",(uid,account)).fetchall()
    db.execute("DELETE FROM history_sessions WHERE user_id=? AND account=?",(uid,account))
    previous=None
    for current in rows:
        if previous is not None:
            changes,totals,material=difference(json.loads(previous["raw_json"]),json.loads(current["raw_json"]))
            if material:
                db.execute("""INSERT INTO history_sessions(user_id,account,from_id,to_id,started_at,ended_at,changes_json,totals_json)
                    VALUES(?,?,?,?,?,?,?,?)""",(uid,account,previous["id"],current["id"],previous["captured_at"],current["captured_at"],
                    json.dumps(changes,separators=(",",":")),json.dumps(totals,separators=(",",":"))))
        previous=current

def ingest(raw,source="manual",uid=None):
    from auth import current_user_id
    if uid is None:uid=current_user_id()
    if uid is None:raise PermissionError("Sign in before importing")
    if isinstance(raw,bytes):
        if len(raw)>MAX_BYTES:raise ValueError("File exceeds size limit")
        raw=json.loads(raw)
    account,stamp=verify(raw)
    payload=json.dumps(raw,ensure_ascii=False,separators=(",",":"),sort_keys=True)
    digest=hashlib.sha256(payload.encode("utf-8")).hexdigest()
    with LOCK:
        with get_db() as db:
            owner=db.execute("SELECT user_id FROM trainer_ownership WHERE trainer=?",(account,)).fetchone()
            if not owner or owner["user_id"]!=uid:raise PermissionError("Trainer must be verified before uploading")
            match=db.execute("SELECT id FROM history_snapshots WHERE user_id=? AND hash=?",(uid,digest)).fetchone()
            if match:return {"status":"duplicate","snapshot_id":match["id"],"account":account}
            cur=db.execute("INSERT INTO history_snapshots(user_id,account,captured_at,hash,source,raw_json) VALUES(?,?,?,?,?,?)",
                           (uid,account,stamp,digest,source,payload))
            rebuild(db,account,uid)
            return {"status":"imported","snapshot_id":cur.lastrowid,"account":account,"captured_at":stamp}

def read_dashboard(account=None):
    from auth import current_user_id
    uid=current_user_id()
    if uid is None:raise PermissionError("Sign in required")
    with get_db() as db:
        if not account:
            row=db.execute("SELECT account FROM history_snapshots WHERE user_id=? ORDER BY captured_at DESC LIMIT 1",(uid,)).fetchone()
            if not row:return {"account":None,"snapshots":0,"sessions":[],"totals":{},"insights":[]}
            account=row["account"]
        snaps=db.execute("SELECT id,captured_at,raw_json FROM history_snapshots WHERE user_id=? AND account=? ORDER BY captured_at,id",(uid,account)).fetchall()
        sessions=db.execute("SELECT * FROM history_sessions WHERE user_id=? AND account=? ORDER BY ended_at",(uid,account)).fetchall()
    if not snaps:return {"account":account,"snapshots":0,"sessions":[],"totals":{},"insights":[]}
    latest=json.loads(snaps[-1]["raw_json"])
    pok=latest["pokemons"]
    balances={c.get("currencyType"):c.get("quantity") for c in latest["account"].get("currencyBalance",[])}
    totals={"pokemon":len(pok),"shinies":sum(bool((p.get("pokemonDisplay") or {}).get("shiny")) for p in pok),
            "hundos":sum([p.get("individualAttack"),p.get("individualDefense"),p.get("individualStamina")]==[15,15,15] for p in pok),
            "xp":latest["player"].get("experience",0),"stardust":balances.get("STARDUST",0),
            "coins":balances.get("POKECOIN",0),"caught_lifetime":latest["player"].get("numPokemonCaptured",0)}
    records=[{"id":r["id"],"start":r["started_at"],"end":r["ended_at"],**json.loads(r["totals_json"])} for r in sessions]
    insights=[]
    for field,title in [("caught","Most caught"),("acquired","Most acquired"),("shinies","Most new shinies"),
                        ("items_gained","Most items gained"),("xp","Most XP")]:
        if records:
            best=max(records,key=lambda r:r[field])
            insights.append({"title":title,"value":best[field],"date":best["end"],"session_id":best["id"]})
    if records:
        best=max(records,key=lambda r:datetime.fromisoformat(r["end"])-datetime.fromisoformat(r["start"]))
        insights.append({"title":"Longest export interval","value":round((datetime.fromisoformat(best["end"])-datetime.fromisoformat(best["start"])).total_seconds()/3600,2),"unit":"hours","date":best["end"],"session_id":best["id"]})
    return {"account":account,"snapshots":len(snaps),"baseline":snaps[0]["captured_at"],"latest":snaps[-1]["captured_at"],"sessions":records,"totals":totals,"insights":insights}

def scan_folder_forever():
    stable={}
    imported=set()
    while True:
        try:
            for path in list(current_watch_dir().glob("*.json"))+list(current_watch_dir().glob("*.txt")):
                try:
                    stat=path.stat()
                    signature=(stat.st_size,stat.st_mtime_ns)
                    key=str(path)
                    if stable.get(key)!=signature:
                        stable[key]=signature
                        imported.discard(key)
                        continue
                    if key in imported:continue
                    raw=path.read_bytes()
                    obj=json.loads(raw)
                    account,_=verify(obj)
                    with get_db() as db:
                        owner=db.execute("SELECT user_id FROM trainer_ownership WHERE trainer=?",(account,)).fetchone()
                    if owner is None:continue
                    ingest(obj,source=key,uid=owner["user_id"])
                    imported.add(key)
                except Exception as ex:
                    print("History watcher:",path,ex,flush=True)
        except Exception as ex:print("History watcher error:",ex,flush=True)
        sleep(5)

def start_watcher():
    Thread(target=scan_folder_forever,daemon=True,name="pgsharp-export-watcher").start()
