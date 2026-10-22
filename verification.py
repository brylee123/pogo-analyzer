"""Server-side trainer verification. A client-supplied export is never an authority."""
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, render_template
from werkzeug.security import generate_password_hash, check_password_hash
from auth import current_user_id
from database import get_db

bp=Blueprint("verification",__name__)
def init_verification():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS trusted_trainers (
          trainer TEXT PRIMARY KEY COLLATE NOCASE,
          date_hash TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'operator',
          failures INTEGER NOT NULL DEFAULT 0
        );
        """)
def trusted_date(timestamp_ms):
    return datetime.fromtimestamp(int(timestamp_ms)/1000,timezone.utc).date().isoformat()
def provision(trainer,timestamp_ms):
    """CLI/server operator only. Never expose as an HTTP endpoint."""
    name=trainer.strip()
    if not name:raise ValueError("Missing trainer")
    with get_db() as db:
        db.execute("INSERT INTO trusted_trainers(trainer,date_hash,source) VALUES(?,?,?)",
                   (name,generate_password_hash(trusted_date(timestamp_ms),method="scrypt"),"operator"))
@bp.get("/verify")
def verify_page():
    return render_template("verify.html")
@bp.post("/api/profile/claim")
def claim():
    uid=current_user_id()
    if uid is None:return jsonify({"error":"Sign in first"}),401
    data=request.get_json(silent=True) or {}
    name=str(data.get("trainer","")).strip()
    date=str(data.get("creation_date","")).strip()
    try:datetime.strptime(date,"%Y-%m-%d")
    except ValueError:return jsonify({"error":"Enter a valid date YYYY-MM-DD"}),400
    with get_db() as db:
        row=db.execute("SELECT * FROM trusted_trainers WHERE trainer=?",(name,)).fetchone()
        if not row:return jsonify({"error":"This trainer requires an administrator to establish a trusted reference before verification."}),409
        owner=db.execute("SELECT user_id FROM trainer_ownership WHERE trainer=?",(name,)).fetchone()
        if owner and owner["user_id"]!=uid:return jsonify({"error":"Trainer is already assigned"}),409
        if row["failures"]>=5:return jsonify({"error":"Verification locked; contact administrator"}),429
        if not check_password_hash(row["date_hash"],date):
            db.execute("UPDATE trusted_trainers SET failures=failures+1 WHERE trainer=?",(name,))
            return jsonify({"error":"Verification failed"}),403
        db.execute("INSERT OR IGNORE INTO trainer_ownership(trainer,user_id) VALUES(?,?)",(name,uid))
        db.execute("UPDATE trusted_trainers SET failures=0 WHERE trainer=?",(name,))
    return jsonify({"verified":True,"trainer":name})
