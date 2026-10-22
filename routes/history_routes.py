"""History API: independent of the existing latest-upload analyzer."""
import json
from datetime import datetime
from flask import Blueprint, request, jsonify
from database import get_db
from history import ingest, read_dashboard, MAX_BYTES
from auth import current_user_id
bp=Blueprint("history",__name__)
@bp.get("/api/history/dashboard")
def dashboard():
    return jsonify(read_dashboard(request.args.get("account")))
@bp.get("/api/history/accounts")
def accounts():
    with get_db() as db:
        return jsonify([dict(row) for row in db.execute("SELECT account,COUNT(*) AS snapshots FROM history_snapshots WHERE user_id=? GROUP BY account ORDER BY account",(current_user_id(),))])
@bp.get("/api/history/sessions/<int:sid>")
def session(sid):
    with get_db() as db:
        row=db.execute("SELECT * FROM history_sessions WHERE id=? AND user_id=?",(sid,current_user_id())).fetchone()
        if not row:return jsonify({"error":"Session not found"}),404
        return jsonify({"id":row["id"],"account":row["account"],"start":row["started_at"],"end":row["ended_at"],
          "changes":json.loads(row["changes_json"]),"totals":json.loads(row["totals_json"])})
@bp.get("/api/history/periods")
def periods():
    granularity=request.args.get("period","day")
    if granularity not in ("day","week","month","year"):return jsonify({"error":"Invalid period"}),400
    data=read_dashboard(request.args.get("account"))
    grouped={}
    for s in data["sessions"]:
        dt=datetime.fromisoformat(s["end"])
        key={"day":lambda:dt.strftime("%Y-%m-%d"),"week":lambda:f"{dt.isocalendar().year}-W{dt.isocalendar().week:02d}",
             "month":lambda:dt.strftime("%Y-%m"),"year":lambda:dt.strftime("%Y")}[granularity]()
        row=grouped.setdefault(key,{"period":key,"sessions":0})
        row["sessions"]+=1
        for k,v in s.items():
            if k in ("id","start","end") or not isinstance(v,(float,int)):continue
            row[k]=row.get(k,0)+v
    return jsonify([grouped[k] for k in sorted(grouped)])
@bp.post("/api/history/upload")
def upload():
    results=[]
    files=request.files.getlist("files") or request.files.getlist("file")
    if not files and request.is_json:
        try:return jsonify(ingest(request.get_json(),"api"))
        except Exception as ex:return jsonify({"error":str(ex)}),400
    for f in files:
        try:results.append({"filename":f.filename,**ingest(f.read(MAX_BYTES+1),"upload:"+f.filename)})
        except Exception as ex:results.append({"filename":f.filename,"status":"error","error":str(ex)})
    return jsonify({"results":results})
