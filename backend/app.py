# pyrefly: ignore [missing-import]
from flask import Flask, request, jsonify
from flask_cors import CORS
import storage, classifier, feature_pipeline, gemini_analyzer

app = Flask(__name__)
CORS(app)

storage.init_db()
classifier.ensure_bootstrap_model()

@app.route('/api/predict', methods=['POST'])
def predict():
    features = request.json
    result = gemini_analyzer.analyze(features)
    state, confidence, reason, suggestion, source, drift_score, components, top_component, drift_source = result
    return jsonify({
        'state': state,
        'confidence': round(confidence, 3),
        'drift_score': round(drift_score, 4),
        'drift_source': drift_source,
        'components': components,
        'top_component': top_component,
        'reason': reason,
        'suggestion': suggestion,
        'source': source,
    })

@app.route('/api/signals', methods=['POST'])
def receive_signals():
    data = request.json
    storage.store_signal(
        data.get('timestamp', 0), 
        data.get('features', {}), 
        data.get('state', 'focused'),
        data.get('reason', ''),
        data.get('suggestion', ''),
        data.get('source', 'local')
    )
    return jsonify({'ok': True})

@app.route('/api/label', methods=['POST'])
def receive_label():
    data = request.json
    recent = storage.get_signals(limit=1)
    features = None
    if recent:
        import json
        features = json.loads(recent[0]['features']) if isinstance(recent[0]['features'], str) else recent[0]['features']
    storage.store_label(data['timestamp'], data['label'], features)
    return jsonify({'ok': True})

@app.route('/api/intervention', methods=['POST'])
def receive_intervention():
    d = request.json
    storage.store_intervention(d.get('timestamp', 0), d.get('type', ''), d.get('action', ''), d.get('state_before', ''), d.get('state_after', ''))
    return jsonify({'ok': True})

@app.route('/api/history', methods=['GET'])
def history():
    since = request.args.get('since', type=float)
    signals = storage.get_signals(since=since)
    return jsonify(signals)

@app.route('/api/interventions', methods=['GET'])
def interventions():
    since = request.args.get('since', type=float)
    return jsonify(storage.get_interventions(since=since))

@app.route('/api/retrain', methods=['POST'])
def retrain():
    result = classifier.train_from_db()
    return jsonify(result)

@app.route('/api/status', methods=['GET'])
def status():
    """Returns label counts and whether a trained model exists."""
    import os
    label_counts = storage.get_label_counts()
    model_exists = os.path.exists(os.path.join(os.path.dirname(__file__), 'model.pkl'))
    return jsonify({
        'label_counts': label_counts,
        'model_trained': model_exists,
        'ready_to_train': label_counts['total'] >= 10
    })

@app.route('/api/cleanup', methods=['POST'])
def cleanup():
    """Prune data older than N days (default 30). Pass {\"days\": N} in body."""
    days = (request.json or {}).get('days', 30)
    result = storage.cleanup_old_data(days=days)
    return jsonify(result)

@app.route('/api/dashboard', methods=['GET'])
def dashboard_data():
    import time, json
    now = time.time() * 1000
    today_start = now - (now % 86400000)
    signals = storage.get_signals(since=today_start, limit=5000)
    interventions = storage.get_interventions(since=today_start)

    timeline = []
    for s in signals:
        f = json.loads(s['features']) if isinstance(s['features'], str) else s['features']
        timeline.append({'timestamp': s['timestamp'], 'state': s['predicted_state'], 'url': f.get('url', ''), **f})

    site_states = {}
    for s in signals:
        f = json.loads(s['features']) if isinstance(s['features'], str) else s['features']
        url = f.get('url', 'unknown')
        if url not in site_states:
            site_states[url] = {'focused': 0, 'drifting': 0, 'gone': 0}
        st = s['predicted_state']
        if st in site_states[url]:
            site_states[url][st] += 1

    week_start = now - 7 * 86400000
    week_signals = storage.get_signals(since=week_start, limit=10000)
    daily = {}
    for s in week_signals:
        day = int(s['timestamp'] // 86400000)
        if day not in daily:
            daily[day] = {'focused': 0, 'drifting': 0, 'gone': 0, 'total': 0}
        st = s['predicted_state']
        if st in daily[day]:
            daily[day][st] += 1
        daily[day]['total'] += 1

    return jsonify({'timeline': timeline, 'siteStates': site_states, 'interventions': interventions, 'weeklyTrends': daily})

if __name__ == '__main__':
    storage.cleanup_old_data(days=30)  # prune data older than 30 days on each startup
    app.run(port=5000, debug=True)
