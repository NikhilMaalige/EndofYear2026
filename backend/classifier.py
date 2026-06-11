import os
import json
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
import feature_pipeline as fp
import attention_engine as ae
import storage

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model.pkl')
STATS_PATH = os.path.join(os.path.dirname(__file__), 'stats.json')
STATE_MAP = {0: 'focused', 1: 'drifting', 2: 'gone'}
LABEL_MAP = {'focused': 0, 'drifting': 1, 'gone': 2}
STATE_ORDER = {'focused': 0, 'drifting': 1, 'gone': 2}

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
            row['tab_switches_per_min'] = max(0, row.get('tab_switches_per_min', 0) + rng.uniform(-2, 2))
            row['mouse_activity'] = max(0, row.get('mouse_activity', 0) + rng.uniform(-1, 3))
            row['idle_seconds'] = max(0, row.get('idle_seconds', 0) + rng.uniform(-10, 10))
            samples.append((row, label))
        return samples

    add('focused', {
        'avg_scroll_velocity': 3, 'scroll_consistency': 0.3, 'tab_switches_5min': 1,
        'tab_switches_per_min': 2, 'idle_seconds': 5, 'direction_changes_per_min': 1,
        'interaction_per_min': 8, 'hovers_per_min': 0, 'passive_browse_score': 0.05,
        'mouse_activity': 8, 'session_duration': 15, 'time_of_day': 14,
        'content_length': 5000, 'scroll_depth_vs_time': 0.05,
        'current_url': 'docs.google.com', 'page_title': 'Project notes',
        'current_goal': 'finish homework',
    })
    add('drifting', {
        'avg_scroll_velocity': 10, 'scroll_consistency': 0.55, 'tab_switches_5min': 8,
        'tab_switches_per_min': 22, 'idle_seconds': 45, 'direction_changes_per_min': 8,
        'interaction_per_min': 2, 'hovers_per_min': 3, 'passive_browse_score': 0.45,
        'mouse_activity': 4, 'session_duration': 25, 'time_of_day': 15,
        'content_length': 8000, 'scroll_depth_vs_time': 0.12,
        'current_url': 'reddit.com', 'page_title': 'Interesting thread',
        'current_goal': 'finish homework',
    })
    add('gone', {
        'avg_scroll_velocity': 18, 'scroll_consistency': 0.82, 'tab_switches_5min': 20,
        'tab_switches_per_min': 42, 'idle_seconds': 90, 'direction_changes_per_min': 15,
        'interaction_per_min': 0.5, 'hovers_per_min': 6, 'passive_browse_score': 0.85,
        'mouse_activity': 2, 'session_duration': 40, 'time_of_day': 16,
        'content_length': 12000, 'scroll_depth_vs_time': 0.25,
        'current_url': 'youtube.com', 'page_title': 'Recommended videos',
        'current_goal': 'finish homework',
    })
    return samples


def _model_feature_count():
    if _model is None:
        return 0
    try:
        if isinstance(_model, dict) and _model.get('ensemble'):
            return _model['rf'].n_features_in_
        return _model.n_features_in_
    except Exception:
        return 0


def ensure_bootstrap_model():
    global _model, _scaler, _stats
    if os.path.exists(MODEL_PATH):
        _load()
        if _model_feature_count() == len(fp.FEATURE_KEYS):
            return {'status': 'exists'}
        _model = None
        _scaler = None
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
    state, conf, _, _, _ = predict_detailed(features)
    return state, conf


def predict_detailed(features):
    global _model, _scaler, _stats
    if _model is None:
        _load()
    if _model is None:
        ensure_bootstrap_model()

    drift_result = ae.compute_drift(features)
    rule_state = drift_result['state']
    rule_conf = drift_result['confidence']
    drift_score = drift_result['drift_score']
    components = drift_result['components']
    reason = drift_result['reason']

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

        final_state = rule_state
        final_conf = rule_conf

        if ml_conf >= 0.6:
            if ml_state == rule_state:
                final_conf = max(rule_conf, ml_conf)
            elif ml_conf >= 0.7 and STATE_ORDER.get(ml_state, 0) > STATE_ORDER.get(rule_state, 0):
                final_state = ml_state
                final_conf = ml_conf * 0.95
            elif ml_conf >= 0.7 and STATE_ORDER.get(ml_state, 0) < STATE_ORDER.get(rule_state, 0):
                final_state = rule_state
                final_conf = rule_conf
            else:
                final_conf = (rule_conf + ml_conf) / 2

        return final_state, final_conf, reason, drift_score, components
    except Exception:
        return rule_state, rule_conf, reason, drift_score, components


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
