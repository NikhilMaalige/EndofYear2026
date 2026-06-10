import os, json, joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import feature_pipeline as fp
import storage

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model.pkl')
STATS_PATH = os.path.join(os.path.dirname(__file__), 'stats.json')
STATE_MAP = {0: 'focused', 1: 'drifting', 2: 'gone'}
LABEL_MAP = {'focused': 0, 'drifting': 1, 'gone': 2}

_model = None
_stats = None

def _load():
    global _model, _stats
    if os.path.exists(MODEL_PATH):
        _model = joblib.load(MODEL_PATH)
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            _stats = json.load(f)

def _rule_based(features):
    v = features.get('avg_scroll_velocity', 0)
    c = features.get('scroll_consistency', 0)
    t = features.get('tab_switches_5min', 0)
    m = features.get('mouse_activity', 0)
    s = features.get('session_duration', 0)
    
    url = str(features.get('current_url', ''))
    title = str(features.get('page_title', ''))
    goal = str(features.get('current_goal', ''))
    
    is_distracting = any(d in url for d in fp.DISTRACTING_DOMAINS)
    relevance = fp._get_relevance_score(title, goal)
    
    score = 0
    if v > 15: score += 2
    elif v > 8: score += 1
    if c > 0.7: score += 2
    if t > 8: score += 2
    elif t > 4: score += 1
    if m < 2 and v > 5: score += 1
    if s > 30: score += 1
    
    if is_distracting:
        if goal and relevance < 0.3:
            score += 4
        elif not goal:
            score += 2
        else:
            score -= 1
    else:
        if goal and relevance > 0.5:
            score -= 2

    if score >= 5: return 'gone'
    if score >= 2: return 'drifting'
    return 'focused'

def predict(features):
    global _model, _stats
    if _model is None:
        _load()
    if _model is None:
        return _rule_based(features)
    try:
        fv = fp.extract(features)
        fv = fp.normalize(fv, _stats)
        pred = _model.predict(fv.reshape(1, -1))[0]
        return STATE_MAP.get(pred, 'focused')
    except:
        return _rule_based(features)

def train_from_db():
    global _model, _stats
    data = storage.get_training_data()
    if len(data) < 10:
        return {'status': 'insufficient_data', 'count': len(data)}
    X, y = [], []
    for row in data:
        features = json.loads(row['features']) if isinstance(row['features'], str) else row['features']
        label = row['label']
        if label not in LABEL_MAP:
            continue
        X.append(fp.extract(features))
        y.append(LABEL_MAP[label])
    if len(X) < 10:
        return {'status': 'insufficient_data', 'count': len(X)}
    X = np.array(X)
    y = np.array(y)
    _stats = fp.compute_stats(X.tolist())
    with open(STATS_PATH, 'w') as f:
        json.dump(_stats, f)
    X_norm = np.array([fp.normalize(x, _stats) for x in X])
    _model = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42)
    _model.fit(X_norm, y)
    joblib.dump(_model, MODEL_PATH)
    return {'status': 'trained', 'samples': len(X), 'classes': list(set(y.tolist()))}
