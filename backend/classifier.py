import os
import json
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
import feature_pipeline as fp
import storage

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model.pkl')
STATS_PATH = os.path.join(os.path.dirname(__file__), 'stats.json')
STATE_MAP = {0: 'focused', 1: 'drifting', 2: 'gone'}
LABEL_MAP = {'focused': 0, 'drifting': 1, 'gone': 2}

_model = None
_scaler = None
_stats = None


def _load():
    global _model, _scaler, _stats
    if os.path.exists(MODEL_PATH):
        bundle = joblib.load(MODEL_PATH)
        if isinstance(bundle, dict):
            _model = bundle.get('model')
            _scaler = bundle.get('scaler')
        else:
            _model = bundle
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            _stats = json.load(f)


def _compute_score(features):
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

    score = 0.0
    if v > 15:
        score += 2
    elif v > 8:
        score += 1
    if c > 0.7:
        score += 2
    if t > 8:
        score += 2
    elif t > 4:
        score += 1
    if m < 2 and v > 5:
        score += 1
    if s > 30:
        score += 1

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

    return score, is_distracting, relevance


def _build_reason(features, state):
    score, is_distracting, relevance = _compute_score(features)
    url = str(features.get('current_url', ''))
    title = str(features.get('page_title', ''))
    goal = str(features.get('current_goal', ''))
    t = features.get('tab_switches_5min', 0)
    v = features.get('avg_scroll_velocity', 0)

    if state == 'focused':
        if goal and relevance > 0.4:
            return f"Page content aligns with your goal."
        return "Behavior patterns look steady and on-task."

    if state == 'drifting':
        parts = []
        if t > 4:
            parts.append(f"{t} tab switches in 5 min")
        if v > 8:
            parts.append("fast scrolling")
        if is_distracting and goal and relevance < 0.3:
            parts.append(f"'{url}' doesn't match your goal")
        if parts:
            return "Drifting: " + ", ".join(parts) + "."
        return "Signals suggest your attention is starting to wander."

    parts = []
    if is_distracting:
        parts.append(f"You're on {url or 'a distracting site'}")
    if goal and relevance < 0.2:
        parts.append(f"which doesn't relate to \"{goal[:40]}\"")
    if t > 6:
        parts.append(f"with {t} recent tab switches")
    if parts:
        return "Off track — " + ", ".join(parts) + "."
    return f"Deep distraction detected on {title[:50] or 'this page'}."


def _rule_based(features):
    score, _, _ = _compute_score(features)
    if score >= 5:
        return 'gone', min(0.55 + score * 0.05, 0.92)
    if score >= 2:
        return 'drifting', min(0.50 + score * 0.06, 0.85)
    return 'focused', min(0.65 + max(0, 2 - score) * 0.08, 0.90)


def _generate_bootstrap_samples():
    """Synthetic training data so the model works before user labels exist."""
    rng = np.random.default_rng(42)
    samples = []

    def add(label, base):
        for _ in range(12):
            row = dict(base)
            for k in fp.FEATURE_KEYS:
                if k not in row:
                    row[k] = 0
            row['avg_scroll_velocity'] += rng.uniform(-2, 2)
            row['scroll_consistency'] += rng.uniform(-0.1, 0.1)
            row['tab_switches_5min'] = max(0, row.get('tab_switches_5min', 0) + rng.integers(-1, 2))
            row['mouse_activity'] = max(0, row.get('mouse_activity', 0) + rng.uniform(-1, 3))
            samples.append((row, label))
        return samples

    add('focused', {
        'avg_scroll_velocity': 3, 'scroll_consistency': 0.3, 'tab_switches_5min': 1,
        'mouse_activity': 8, 'session_duration': 15, 'time_of_day': 14,
        'content_length': 5000, 'scroll_depth_vs_time': 0.05,
        'current_url': 'docs.google.com', 'page_title': 'Project notes',
        'current_goal': 'finish homework',
    })
    add('drifting', {
        'avg_scroll_velocity': 10, 'scroll_consistency': 0.55, 'tab_switches_5min': 5,
        'mouse_activity': 4, 'session_duration': 25, 'time_of_day': 15,
        'content_length': 8000, 'scroll_depth_vs_time': 0.12,
        'current_url': 'reddit.com', 'page_title': 'Interesting thread',
        'current_goal': 'finish homework',
    })
    add('gone', {
        'avg_scroll_velocity': 18, 'scroll_consistency': 0.82, 'tab_switches_5min': 10,
        'mouse_activity': 2, 'session_duration': 40, 'time_of_day': 16,
        'content_length': 12000, 'scroll_depth_vs_time': 0.25,
        'current_url': 'youtube.com', 'page_title': 'Recommended videos',
        'current_goal': 'finish homework',
    })
    return samples


def ensure_bootstrap_model():
    global _model, _scaler, _stats
    if os.path.exists(MODEL_PATH):
        _load()
        return {'status': 'exists'}
    samples = _generate_bootstrap_samples()
    X, y = [], []
    for row, label in samples:
        X.append(fp.extract(row))
        y.append(LABEL_MAP[label])
    X = np.array(X)
    y = np.array(y)
    _stats = fp.compute_stats(X.tolist())
    with open(STATS_PATH, 'w') as f:
        json.dump(_stats, f)
    _scaler = StandardScaler()
    X_scaled = _scaler.fit_transform(X)
    rf = RandomForestClassifier(n_estimators=80, max_depth=6, random_state=42)
    gb = GradientBoostingClassifier(n_estimators=60, max_depth=4, random_state=42)
    rf.fit(X_scaled, y)
    gb.fit(X_scaled, y)
    _model = {'rf': rf, 'gb': gb, 'ensemble': True}
    joblib.dump({'model': _model, 'scaler': _scaler}, MODEL_PATH)
    return {'status': 'bootstrapped', 'samples': len(X)}


def _ensemble_predict(fv_scaled):
    proba_rf = _model['rf'].predict_proba(fv_scaled)[0]
    proba_gb = _model['gb'].predict_proba(fv_scaled)[0]
    proba = (proba_rf * 0.45 + proba_gb * 0.55)
    pred_idx = int(np.argmax(proba))
    return STATE_MAP.get(pred_idx, 'focused'), float(proba[pred_idx])


def predict(features):
    state, conf, _, _ = predict_detailed(features)
    return state, conf


def predict_detailed(features):
    global _model, _scaler, _stats
    if _model is None:
        _load()
    if _model is None:
        ensure_bootstrap_model()

    rule_state, rule_conf = _rule_based(features)
    score, _, _ = _compute_score(features)

    try:
        fv = fp.extract(features)
        if _scaler is not None:
            fv_scaled = _scaler.transform(fv.reshape(1, -1))
        else:
            fv_norm = fp.normalize(fv, _stats)
            fv_scaled = fv_norm.reshape(1, -1)

        if isinstance(_model, dict) and _model.get('ensemble'):
            ml_state, ml_conf = _ensemble_predict(fv_scaled)
        else:
            proba = _model.predict_proba(fv_scaled)[0]
            pred_idx = int(np.argmax(proba))
            ml_state, ml_conf = STATE_MAP.get(pred_idx, 'focused'), float(proba[pred_idx])

        state_order = {'focused': 0, 'drifting': 1, 'gone': 2}
        final_state = ml_state if ml_conf >= 0.55 else rule_state
        if state_order.get(rule_state, 0) > state_order.get(ml_state, 0) and rule_conf >= 0.6:
            final_state = rule_state
        final_conf = max(ml_conf, rule_conf) if final_state == ml_state else rule_conf

        reason = _build_reason(features, final_state)
        return final_state, final_conf, reason, score
    except Exception:
        reason = _build_reason(features, rule_state)
        return rule_state, rule_conf, reason, score


def train_from_db():
    global _model, _scaler, _stats
    data = storage.get_training_data()
    bootstrap = _generate_bootstrap_samples()
    X, y = [], []

    for row, label in bootstrap:
        X.append(fp.extract(row))
        y.append(LABEL_MAP[label])

    for row in data:
        features = json.loads(row['features']) if isinstance(row['features'], str) else row['features']
        label = row['label']
        if label not in LABEL_MAP or not features:
            continue
        X.append(fp.extract(features))
        y.append(LABEL_MAP[label])

    if len(data) < 5:
        return {'status': 'insufficient_data', 'count': len(data)}

    X = np.array(X)
    y = np.array(y)
    _stats = fp.compute_stats(X.tolist())
    with open(STATS_PATH, 'w') as f:
        json.dump(_stats, f)

    _scaler = StandardScaler()
    X_scaled = _scaler.fit_transform(X)
    rf = RandomForestClassifier(n_estimators=80, max_depth=6, random_state=42)
    gb = GradientBoostingClassifier(n_estimators=60, max_depth=4, random_state=42)
    rf.fit(X_scaled, y)
    gb.fit(X_scaled, y)
    _model = {'rf': rf, 'gb': gb, 'ensemble': True}
    joblib.dump({'model': _model, 'scaler': _scaler}, MODEL_PATH)
    return {'status': 'trained', 'samples': len(X), 'user_labels': len(data), 'classes': list(set(y.tolist()))}
