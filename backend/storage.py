import sqlite3, json, os, threading

DB_PATH = os.path.join(os.path.dirname(__file__), 'attention.db')
_local = threading.local()

def get_db():
    if not hasattr(_local, 'conn'):
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.row_factory = sqlite3.Row
    return _local.conn

def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            features TEXT,
            predicted_state TEXT,
            reason TEXT,
            suggestion TEXT,
            source TEXT
        );
        CREATE TABLE IF NOT EXISTS labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            label TEXT,
            features TEXT
        );
        CREATE TABLE IF NOT EXISTS interventions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            type TEXT,
            action TEXT,
            state_before TEXT,
            state_after TEXT
        );
    ''')
    db.commit()

def store_signal(timestamp, features, state, reason="", suggestion="", source="local"):
    db = get_db()
    db.execute('INSERT INTO signals (timestamp, features, predicted_state, reason, suggestion, source) VALUES (?, ?, ?, ?, ?, ?)', (timestamp, json.dumps(features), state, reason, suggestion, source))
    db.commit()

def store_label(timestamp, label, features=None):
    db = get_db()
    db.execute('INSERT INTO labels (timestamp, label, features) VALUES (?, ?, ?)', (timestamp, label, json.dumps(features) if features else None))
    db.commit()

def store_intervention(timestamp, itype, action, state_before, state_after):
    db = get_db()
    db.execute('INSERT INTO interventions (timestamp, type, action, state_before, state_after) VALUES (?, ?, ?, ?, ?)', (timestamp, itype, action, state_before, state_after))
    db.commit()

def get_signals(since=None, limit=1000):
    db = get_db()
    if since:
        rows = db.execute('SELECT * FROM signals WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?', (since, limit)).fetchall()
    else:
        rows = db.execute('SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?', (limit,)).fetchall()
    return [dict(r) for r in rows]

def get_labels(limit=5000):
    db = get_db()
    return [dict(r) for r in db.execute('SELECT * FROM labels ORDER BY timestamp DESC LIMIT ?', (limit,)).fetchall()]

def get_interventions(since=None):
    db = get_db()
    if since:
        rows = db.execute('SELECT * FROM interventions WHERE timestamp > ? ORDER BY timestamp DESC', (since,)).fetchall()
    else:
        rows = db.execute('SELECT * FROM interventions ORDER BY timestamp DESC LIMIT 200').fetchall()
    return [dict(r) for r in rows]

def get_training_data():
    db = get_db()
    labels = db.execute('SELECT * FROM labels WHERE features IS NOT NULL ORDER BY timestamp').fetchall()
    return [dict(r) for r in labels]

def get_label_counts():
    """Return per-class label counts and total, used by the popup status endpoint."""
    db = get_db()
    rows = db.execute('SELECT label, COUNT(*) as cnt FROM labels GROUP BY label').fetchall()
    counts = {'focused': 0, 'drifting': 0, 'gone': 0}
    for r in rows:
        if r['label'] in counts:
            counts[r['label']] = r['cnt']
    counts['total'] = sum(counts.values())
    return counts

def cleanup_old_data(days=30):
    """Delete signals, labels, and interventions older than `days` days."""
    import time
    cutoff = (time.time() - days * 86400) * 1000  # stored as JS timestamp (ms)
    db = get_db()
    db.execute('DELETE FROM signals WHERE timestamp < ?', (cutoff,))
    db.execute('DELETE FROM labels WHERE timestamp < ?', (cutoff,))
    db.execute('DELETE FROM interventions WHERE timestamp < ?', (cutoff,))
    db.commit()
    return {'deleted_before_ms': cutoff, 'cutoff_days': days}
