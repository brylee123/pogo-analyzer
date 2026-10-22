"""First-run setup: trusted local directory, first administrator and chronological backfill."""
import json
import os
import sqlite3
from pathlib import Path
from threading import RLock
from flask import Blueprint, request, jsonify, render_template, session
from werkzeug.security import generate_password_hash
from database import get_db
from history import verify, ingest, MAX_BYTES
from verification import provision
from auth import current_user_id

bp=Blueprint("setup",__name__)
LOCK=RLock()

def initialized():
    with get_db() as db:
        return db.execute("SELECT EXISTS(SELECT 1 FROM app_users)").fetchone()[0]==1

def scan_directory(raw_path):
    path=Path(raw_path).expanduser().resolve(strict=True)
    if not path.is_dir():raise ValueError("Path must identify an existing server-side directory")
    entries=[]
    for f in sorted(path.iterdir()):
        if not f.is_file() or f.suffix.lower() not in (".json",".txt"):continue
        if f.stat().st_size>MAX_BYTES:continue
        try:
            obj=json.loads(f.read_text(encoding="utf-8-sig"))
            trainer,ts=verify(obj)
            entries.append((ts,trainer,f,obj))
        except (OSError,ValueError,UnicodeError,TypeError,KeyError):
            continue
    entries.sort(key=lambda row:(row[0],row[2].name))
    return path,entries

@bp.get("/setup")
def setup_page():
    if initialized():return ("Setup is already complete.",409)
    return render_template("setup.html")

@bp.post("/api/setup")
def run_setup():
    # Restrict bootstrap to the host loopback interface. Never trust X-Forwarded-For.
    if request.remote_addr not in ("127.0.0.1","::1"):
        return jsonify({"error":"First-run setup is only available from the server computer"}),403
    data=request.get_json(silent=True) or {}
    folder=str(data.get("directory","")).strip()
    username=str(data.get("username","")).strip()
    password=str(data.get("password",""))
    if not 3<=len(username)<=32 or not all(c.isalnum() or c in "-_" for c in username):
        return jsonify({"error":"Invalid username"}),400
    if not 12<=len(password)<=1024:return jsonify({"error":"Password must contain at least 12 characters"}),400
    try:
        path,entries=scan_directory(folder)
        if not entries:return jsonify({"error":"Directory must contain at least one valid full PGSharp JSON export"}),400
        trainers=sorted({row[1] for row in entries})
        if len(trainers)!=1:
            return jsonify({"error":"First-run directory must contain exports for exactly one trainer; use separate folders for other players.","trainers":trainers}),400
        if not entries[0][3]["account"].get("creationTimeMs"):
            return jsonify({"error":"Baseline export is missing account creation date"}),400
        with LOCK:
            if initialized():return jsonify({"error":"Setup already complete"}),409
            with get_db() as db:
                db.execute("BEGIN IMMEDIATE")
                try:
                    cur=db.execute("INSERT INTO app_users(username,password_hash) VALUES(?,?)",
                        (username,generate_password_hash(password,method="scrypt")))
                    uid=cur.lastrowid
                    trainer=trainers[0]
                    db.execute("INSERT INTO trainer_ownership(trainer,user_id) VALUES(?,?)",(trainer,uid))
                    # The initial directory is an administrator-provided trusted source.
                    db.execute("INSERT INTO trusted_trainers(trainer,date_hash,source) VALUES(?,?,?)",
                        (trainer,generate_password_hash(
                            __import__("verification").trusted_date(entries[0][3]["account"]["creationTimeMs"]),
                            method="scrypt"),"bootstrap-directory"))
                    db.commit()
                except Exception:
                    db.rollback()
                    raise
            imported=0
            errors=[]
            for ts,trainer,f,obj in entries:
                try:
                    result=ingest(obj,source=str(f),uid=uid)
                    if result["status"]=="imported":imported+=1
                except Exception as exc:errors.append({"filename":f.name,"error":str(exc)})
            if not imported:
                return jsonify({"error":"Administrator created, but no snapshots imported; inspect import errors.","details":errors}),500
            latest=entries[-1][3]
            from database import save_upload
            session.clear();session["user_id"]=uid
            save_upload(latest)
            # Store the folder for subsequent service restarts and live monitoring.
            with get_db() as db:
                db.execute("CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
                db.execute("INSERT OR REPLACE INTO app_settings(key,value) VALUES('watch_directory',?)",(str(path),))
            return jsonify({"ok":True,"account":trainer,"snapshots":imported,"skipped":len(entries)-imported,"errors":errors})
    except (OSError,ValueError,sqlite3.Error) as exc:
        return jsonify({"error":str(exc)}),400
