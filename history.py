"""Historical full-export storage and chronologically rebuilt Pokémon GO sessions."""
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock, Thread
from time import sleep
from database import get_db

LOCK = RLock()
WATCH_DIR = Path(os.getenv("PGS_EXPORT_DIR", "exports")).resolve()
MAX_BYTES = int(os.getenv("PGS_MAX_UPLOAD_MB", "80")) * 1024 * 1024

def init_history():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS history_snapshots(
          id INTEGER PRIMARY KEY, account TEXT NOT NULL,
          captured_at TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
          source TEXT NOT NULL, raw_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_history_account_time
          ON history_snapshots(account,captured_at,id);
        CREATE TABLE IF NOT EXISTS history_sessions(
          id INTEGER PRIMARY KEY, account TEXT NOT NULL,
          from_id INTEGER NOT NULL, to_id INTEGER NOT NULL UNIQUE,
          started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
          changes_json TEXT NOT NULL, totals_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_sessions_account_time
          ON history_sessions(account,ended_at);
        """)
        
def export_time(raw):
    from datetime import timedelta
    value = raw.get("time")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / (1000 if value > 100000000000 else 1), timezone.utc).isoformat()
    if isinstance(value, str):
        import re
        match = re.match(r"^(\\d{4}-\\d\\d-\\d\\d)[ T](\\d\\d:\\d\\d:\\d\\d)(?:\\s*(EDT|EST|UTC|GMT))?", value.strip())
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

def rebuild(db,account):
    rows=db.execute("SELECT * FROM history_snapshots WHERE account=? ORDER BY captured_at,id",(account,)).fetchall()
    db.execute("DELETE FROM history_sessions WHERE account=?",(account,))
    previous=None
    for current in rows:
        if previous is not None:
            changes,totals,material=difference(json.loads(previous["raw_json"]),json.loads(current["raw_json"]))
            if material:
                db.execute("""INSERT INTO history_sessions(account,from_id,to_id,started_at,ended_at,changes_json,totals_json)
                    VALUES(?,?,?,?,?,?,?)""",(account,previous["id"],current["id"],previous["captured_at"],current["captured_at"],
                    json.dumps(changes,separators=(",",":")),json.dumps(totals,separators=(",",":"))))
        previous=current

def ingest(raw,source="manual"):
    if isinstance(raw,bytes):
        if len(raw)>MAX_BYTES:raise ValueError("File exceeds size limit")
        raw=json.loads(raw)
    account,stamp=verify(raw)
    payload=json.dumps(raw,ensure_ascii=False,separators=(",",":"),sort_keys=True)
    digest=hashlib.sha256(payload.encode("utf-8")).hexdigest()
    with LOCK:
        with get_db() as db:
            match=db.execute("SELECT id FROM history_snapshots WHERE hash=?",(digest,)).fetchone()
            if match:return {"status":"duplicate","snapshot_id":match["id"],"account":account}
            cur=db.execute("INSERT INTO history_snapshots(account,captured_at,hash,source,raw_json) VALUES(?,?,?,?,?)",
                           (account,stamp,digest,source,payload))
            rebuild(db,account)
            return {"status":"imported","snapshot_id":cur.lastrowid,"account":account,"captured_at":stamp}

def read_dashboard(account=None):
    with get_db() as db:
        if not account:
            row=db.execute("SELECT account FROM history_snapshots ORDER BY captured_at DESC LIMIT 1").fetchone()
            if not row:return {"account":None,"snapshots":0,"sessions":[],"totals":{},"insights":[]}
            account=row["account"]
        snaps=db.execute("SELECT id,captured_at,raw_json FROM history_snapshots WHERE account=? ORDER BY captured_at,id",(account,)).fetchall()
        sessions=db.execute("SELECT * FROM history_sessions WHERE account=? ORDER BY ended_at",(account,)).fetchall()
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
    WATCH_DIR.mkdir(parents=True,exist_ok=True)
    stable={}
    imported=set()
    while True:
        try:
            for path in list(WATCH_DIR.glob("*.json"))+list(WATCH_DIR.glob("*.txt")):
                try:
                    stat=path.stat()
                    signature=(stat.st_size,stat.st_mtime_ns)
                    key=str(path)
                    if stable.get(key)!=signature:
                        stable[key]=signature
                        imported.discard(key)
                        continue
                    if key in imported:continue
                    ingest(path.read_bytes(),source=key)
                    imported.add(key)
                except Exception as ex:
                    print("History watcher:",path,ex,flush=True)
        except Exception as ex:print("History watcher error:",ex,flush=True)
        sleep(5)

def start_watcher():
    Thread(target=scan_folder_forever,daemon=True,name="pgsharp-export-watcher").start()
