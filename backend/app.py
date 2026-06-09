from flask import Flask, request, jsonify
from flask_cors import CORS
import storage, classifier, feature_pipeline

app = Flask(__name__)
CORS(app)

storage.init_db()

@app.route('/api/predict', methods=['POST'])
def predict():
    features = request.json
    state = classifier.predict(features)
    return jsonify({'state': state})

@app.route('/api/signals', methods=['POST'])
def receive_signals():
    data = request.json
    storage.store_signal(data.get('timestamp', 0), data.get('features', {}), data.get('state', 'focused'))
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
    app.run(port=5000, debug=True)
