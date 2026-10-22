"""History API: independent of the existing latest-upload analyzer."""
import json
from datetime import datetime
from flask import Blueprint, request, jsonify
from database import get_db
from history import ingest, read_dashboard, MAX_BYTES
from auth import current_user_id
from history_reports import history_report, session_detail
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
    data = session_detail(current_user_id(), sid)
    return (jsonify(data),200) if data else (jsonify({'error':'Session not found'}),404)

@bp.get('/api/history/report')
def report():
    try:
        return jsonify(history_report(current_user_id(), request.args.get('account'),
            request.args.get('period','session'), request.args.get('start'), request.args.get('end')))
    except ValueError as exc:
        return jsonify({'error':str(exc)}),400

@bp.post('/api/history/restore-legacy')
def restore_legacy():
    from history import claim_legacy_history
    uid=current_user_id()
    with get_db() as db:
        trainers=[row['trainer'] for row in db.execute('SELECT trainer FROM trainer_ownership WHERE user_id=?',(uid,))]
        for trainer in trainers:
            claim_legacy_history(db,trainer,uid)
    return jsonify({'ok':True})

@bp.post('/api/history/import-current')
def import_current():
    with get_db() as db:
        row=db.execute('SELECT raw_json FROM user_latest_upload WHERE user_id=?',(current_user_id(),)).fetchone()
    if row is None:
        return jsonify({'error':'No current export to import'}),400
    try:
        raw=json.loads(row['raw_json'])
        if raw.get('source')=='pokegenie':
            raise ValueError('Session history requires a full timestamped PGSharp export, not a CSV import')
        return jsonify(ingest(raw,source='current-export'))
    except (ValueError,PermissionError,TypeError,KeyError) as exc:
        return jsonify({'error':str(exc)}),400
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
