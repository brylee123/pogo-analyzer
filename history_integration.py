"""Attach history features to the existing Flask application without replacing existing routes."""
from history import init_history, start_watcher
from routes.history_routes import bp as history_bp
def attach(app):
    init_history()
    app.register_blueprint(history_bp)
    start_watcher()
