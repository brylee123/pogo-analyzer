"""Command-line server settings; explicit options take precedence over .env."""
import argparse
import os


def server_options(argv=None):
    parser = argparse.ArgumentParser(description="Run PokéGO Analyzer on your local network")
    parser.add_argument("--host", default=os.environ.get("HOST") or "0.0.0.0",
                        help="Listening address (default: HOST or 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT") or "6090"),
                        help="Listening port (default: PORT or 6090)")
    return parser.parse_args(argv)
