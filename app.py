"""PokéGO Analyzer — Flask entry point.

Uruchomienie:
    pip install -r requirements.txt
    cp .env.example .env && vim .env
    python app.py
"""
import logging
import threading
import os
from flask import g

from flask import Flask, render_template

import config
from database import init_db, load_user_state
from routes.ai_routes import bp as ai_bp
from routes.analysis import bp as analysis_bp
from routes.misc import bp as misc_bp
from routes.pokemon import bp as pokemon_bp
from services.tiers import _tier_refresh_needed, scrape_pokebase
from history_integration import attach as attach_history
from auth import bp as auth_bp, init_auth, auth_gate, current_user_id
from state import set_request_state, clear_request_state

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Lax',SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE')=='1',MAX_CONTENT_LENGTH=80*1024*1024)
init_db()
init_auth()
app.register_blueprint(auth_bp)

app.register_blueprint(pokemon_bp)
app.register_blueprint(analysis_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(misc_bp)
attach_history(app)

@app.before_request
def initialize_user_request():
    denied=auth_gate()
    if denied is not None:return denied
    g.state_token=set_request_state()
    uid=current_user_id()
    if uid:load_user_state(uid)

@app.teardown_request
def cleanup_user_request(exception):
    token=getattr(g,'state_token',None)
    if token is not None:clear_request_state(token)


@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    if _tier_refresh_needed():
        log.info("Starting background tier scrape…")
        threading.Thread(target=scrape_pokebase, daemon=True).start()
    app.run(debug=False, host=os.environ.get('HOST','127.0.0.1'), port=int(os.environ.get('PORT','5000')))
