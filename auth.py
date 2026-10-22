"""Local account authentication. No third-party identity provider required."""
import os
import sqlite3
from functools import wraps
from flask import Blueprint, request, session, jsonify, redirect, render_template, g
from werkzeug.security import generate_password_hash, check_password_hash
from database import get_db

bp=Blueprint("auth",__name__)
def init_auth():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS app_users(
          id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS trainer_ownership(
          trainer TEXT PRIMARY KEY COLLATE NOCASE, user_id INTEGER NOT NULL REFERENCES app_users(id));
        CREATE TABLE IF NOT EXISTS user_latest_upload(
          user_id INTEGER PRIMARY KEY REFERENCES app_users(id),
          raw_json TEXT NOT NULL, saved_at TEXT DEFAULT CURRENT_TIMESTAMP);
        """)
def current_user_id():
    uid=session.get("user_id")
    if not isinstance(uid,int):return None
    with get_db() as db:
        row=db.execute("SELECT id FROM app_users WHERE id=?",(uid,)).fetchone()
    return row["id"] if row else None

@bp.post("/auth/register")
def register():
    data=request.get_json(silent=True) or request.form
    name=str(data.get("username","")).strip()
    pwd=str(data.get("password",""))
    if len(name)<3 or len(name)>32 or not all(c.isalnum() or c in "-_" for c in name):
        return jsonify({"error":"Username must be 3–32 letters, digits, - or _"}),400
    if len(pwd)<12 or len(pwd)>1024:return jsonify({"error":"Password must be at least 12 characters"}),400
    try:
        with get_db() as db:
            row=db.execute("INSERT INTO app_users(username,password_hash) VALUES(?,?)",
                           (name,generate_password_hash(pwd,method="scrypt")))
            uid=row.lastrowid
    except sqlite3.IntegrityError:return jsonify({"error":"Username is unavailable"}),409
    session.clear()
    session["user_id"]=uid
    return jsonify({"ok":True,"username":name}),201

@bp.post("/auth/login")
def login():
    data=request.get_json(silent=True) or request.form
    name=str(data.get("username","")).strip()
    pwd=str(data.get("password",""))
    with get_db() as db:
        row=db.execute("SELECT * FROM app_users WHERE username=?",(name,)).fetchone()
    if not row or not check_password_hash(row["password_hash"],pwd):
        return jsonify({"error":"Invalid username or password"}),401
    session.clear()
    session["user_id"]=row["id"]
    return jsonify({"ok":True,"username":row["username"]})

@bp.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok":True})
@bp.get("/auth/me")
def me():
    uid=current_user_id()
    if uid is None:return jsonify({"authenticated":False}),401
    with get_db() as db:
        row=db.execute("SELECT username FROM app_users WHERE id=?",(uid,)).fetchone()
        trainers=[x["trainer"] for x in db.execute("SELECT trainer FROM trainer_ownership WHERE user_id=?",(uid,))]
    return jsonify({"authenticated":True,"username":row["username"],"trainers":trainers})

def auth_gate():
    if request.path.startswith("/static/") or request.endpoint in ("auth.register","auth.login","auth.me","auth.logout","auth.login_page"):
        return
    if current_user_id() is None:
        if request.path=="/":return redirect("/login")
        return jsonify({"error":"Authentication required"}),401
    if request.method not in ("GET","HEAD","OPTIONS") and request.endpoint not in ("auth.login","auth.register"):
        # Same-origin JS needs CSRF protection; requests with no or foreign Origin are denied.
        origin=request.headers.get("Origin")
        from urllib.parse import urlparse
        if origin and urlparse(origin).netloc!=request.host:
            return jsonify({"error":"Invalid request origin"}),403
        if not origin and request.headers.get("Sec-Fetch-Site") not in ("same-origin","none"):
            return jsonify({"error":"Cross-site request blocked"}),403

@bp.get("/login")
def login_page():
    if current_user_id() is not None:return redirect("/verify")
    return render_template("login.html")
