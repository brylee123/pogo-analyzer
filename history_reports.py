"""UTC history reports, attributed to each export interval's end timestamp."""
import json
from contextlib import closing
from datetime import datetime, time, timedelta, timezone
from database import get_db

METRICS = ('caught', 'acquired', 'removed', 'modified', 'shinies', 'hundos', 'xp',
           'stardust', 'coins', 'distance_km', 'items_gained', 'items_spent')


def date_bound(value, end=False):
    if not value:
        return None
    try:
        if len(value) == 10:
            result = datetime.combine(datetime.fromisoformat(value).date(), time.min, timezone.utc)
            return result + timedelta(days=1) if end else result
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        raise ValueError('Use an ISO date (YYYY-MM-DD) or timestamp')


def history_report(uid, account=None, period='session', start=None, end=None):
    if uid is None:
        raise PermissionError('Sign in required')
    if period not in ('session', 'day', 'week', 'month', 'year'):
        raise ValueError('Choose session, day, week, month, or year')
    lower, upper = date_bound(start), date_bound(end, end=True)
    if lower and upper and lower >= upper:
        raise ValueError('Start date must not be after the end date')
    with closing(get_db()) as db:
        accounts = [dict(row) for row in db.execute('''SELECT account,COUNT(*) AS snapshots
            FROM history_snapshots WHERE user_id=? GROUP BY account ORDER BY account''', (uid,))]
        if not account and accounts:
            account = accounts[0]['account']
        metadata = db.execute('''SELECT COUNT(*) AS snapshots,MIN(captured_at) AS baseline,
            MAX(captured_at) AS latest FROM history_snapshots WHERE user_id=? AND account=?''', (uid, account)).fetchone()
        rows = db.execute('''SELECT id,started_at,ended_at,totals_json FROM history_sessions
            WHERE user_id=? AND account=? ORDER BY ended_at,id''', (uid, account)).fetchall()
        pending = db.execute('''SELECT COUNT(*) FROM history_snapshots s
            JOIN trainer_ownership o ON s.account=o.trainer COLLATE NOCASE
            WHERE s.user_id IS NULL AND o.user_id=?''', (uid,)).fetchone()[0]
    sessions = []
    for row in rows:
        stamp = date_bound(row['ended_at'])
        if (lower and stamp < lower) or (upper and stamp >= upper):
            continue
        totals = json.loads(row['totals_json'])
        sessions.append({'id':row['id'], 'start':row['started_at'], 'end':row['ended_at'],
                         **{key:totals.get(key,0) for key in METRICS}})
    totals = {key:sum(row[key] for row in sessions) for key in METRICS}
    if period == 'session':
        records = [dict(row, sessions=1, period=row['end']) for row in sessions]
    else:
        grouped = {}
        for row in sessions:
            dt = date_bound(row['end'])
            key = {'day':dt.strftime('%Y-%m-%d'),
                   'week':f'{dt.isocalendar().year}-W{dt.isocalendar().week:02d}',
                   'month':dt.strftime('%Y-%m'), 'year':dt.strftime('%Y')}[period]
            group = grouped.setdefault(key, {'period':key,'sessions':0, **{metric:0 for metric in METRICS}})
            group['sessions'] += 1
            for metric in METRICS:
                group[metric] += row[metric]
        records = [grouped[key] for key in sorted(grouped)]
    return {'account':account, 'accounts':accounts, **dict(metadata), 'unassigned_snapshots':pending,
            'period':period, 'start':start, 'end':end, 'session_count':len(sessions),
            'totals':totals, 'records':records, 'timezone':'UTC',
            'attribution':'Each full-export comparison is assigned to its end date; intervals are not split across periods.'}


def session_detail(uid, sid):
    from parser import _pokemon_name
    from data.cpm import cpm_to_level
    from data.pokedex import _resolve_item_name
    with closing(get_db()) as db:
        row = db.execute('SELECT * FROM history_sessions WHERE id=? AND user_id=?', (sid,uid)).fetchone()
        if row is None:
            return None
        snapshots = db.execute('''SELECT id,raw_json FROM history_snapshots
            WHERE user_id=? AND id IN (?,?)''', (uid,row['from_id'],row['to_id'])).fetchall()
    raw = {snap['id']:json.loads(snap['raw_json']) for snap in snapshots}
    previous = {str(p['id']):p for p in raw.get(row['from_id'],{}).get('pokemons',[])}
    current = {str(p['id']):p for p in raw.get(row['to_id'],{}).get('pokemons',[])}
    changes = json.loads(row['changes_json'])
    def decorate(p, source):
        original = source.get(str(p.get('id')), {})
        iv = p.get('iv') or [0,0,0]
        return {**p, 'pid':p.get('species'), 'name':_pokemon_name(p.get('species'),p.get('form') or ''),
                'iv_pct':round(sum(value or 0 for value in iv)/45*100,1),
                'lvl':cpm_to_level((original.get('cpMultiplier') or 0)+(original.get('additionalCpMultiplier') or 0)) if original.get('cpMultiplier') else None}
    changes['added'] = [decorate(p,current) for p in changes.get('added',[])]
    changes['removed'] = [decorate(p,previous) for p in changes.get('removed',[])]
    changes['modified'] = [{'pokemon':decorate(p['pokemon'],current),'before':decorate(p['before'],previous)} for p in changes.get('modified',[])]
    item_names = {str(it.get('item') or it.get('itemId')):it.get('itemName','')
                  for export in raw.values() for it in export.get('items',[])}
    changes['item_details'] = [{'id':iid,'name':_resolve_item_name(int(iid),item_names.get(iid,'')), 'delta':delta}
                               for iid,delta in changes.get('items',{}).items()]
    return {'id':sid, 'account':row['account'], 'start':row['started_at'], 'end':row['ended_at'],
            'totals':json.loads(row['totals_json']), 'changes':changes}
