"""Serve optional user-supplied images. Never download or proxy artwork."""
import json
import os
from contextlib import closing
from pathlib import Path
from flask import Blueprint, jsonify, request, send_file
import config
from auth import current_user_id
from database import get_db

bp = Blueprint('assets', __name__)
ASSET_ROOT = Path(os.environ.get('PGS_ASSET_DIR') or config.BASE_DIR / 'local_assets').resolve()
EXTENSIONS = {'.png','.webp','.jpg','.jpeg','.gif','.svg'}
MODES = ('local-first','local-only','wiki')


def init_assets():
    with closing(get_db()) as db, db:
        db.execute('''CREATE TABLE IF NOT EXISTS user_asset_preferences(
            user_id INTEGER PRIMARY KEY REFERENCES app_users(id),
            mode TEXT NOT NULL DEFAULT 'local-first')''')


def safe_asset(relative):
    root = ASSET_ROOT.resolve()
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    if candidate.suffix.lower() not in EXTENSIONS or not candidate.is_file():
        return None
    return candidate


def catalog(uid):
    from urllib.parse import quote
    files, issues, overrides = {}, [], {}
    if ASSET_ROOT.is_dir():
        for file in sorted(ASSET_ROOT.rglob('*')):
            if file.suffix.lower() not in EXTENSIONS:
                continue
            relative = file.relative_to(ASSET_ROOT).as_posix()
            safe = safe_asset(relative)
            if safe:
                files[relative] = '/local-assets/' + quote(relative, safe='/') + '?v=' + str(safe.stat().st_mtime_ns)
        manifest = ASSET_ROOT / 'manifest.json'
        if manifest.is_file():
            try:
                content=json.loads(manifest.read_text(encoding='utf-8'))
                if not isinstance(content,dict):
                    raise ValueError('Manifest must be a JSON object')
                for key,relative in content.items():
                    if isinstance(relative,str) and relative in files:
                        overrides[str(key)] = files[relative]
                    else:
                        issues.append('Missing or invalid manifest asset: ' + str(key))
            except (ValueError,OSError) as exc:
                issues.append('Unable to read manifest.json: ' + str(exc))
    with closing(get_db()) as db:
        row=db.execute('SELECT mode FROM user_asset_preferences WHERE user_id=?',(uid,)).fetchone()
    return {'mode':row['mode'] if row else 'local-first','files':files,'overrides':overrides,
            'count':len(files),'issues':issues}


@bp.get('/api/assets/catalog')
def asset_catalog():
    return jsonify(catalog(current_user_id()))


@bp.put('/api/assets/preferences')
def asset_preferences():
    data=request.get_json(silent=True)
    if not isinstance(data,dict) or set(data)!={'mode'} or data['mode'] not in MODES:
        return jsonify({'error':'Choose local-first, local-only, or wiki'}),400
    with closing(get_db()) as db, db:
        db.execute('''INSERT INTO user_asset_preferences(user_id,mode) VALUES(?,?)
            ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode''',(current_user_id(),data['mode']))
    return jsonify({'mode':data['mode']})


@bp.get('/local-assets/<path:relative>')
def asset_file(relative):
    file=safe_asset(relative)
    if file is None:
        return jsonify({'error':'Asset not found'}),404
    response=send_file(file, conditional=True)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Content-Security-Policy']="default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return response
