import numpy as np
import re
import attention_engine as ae

FEATURE_KEYS = [
    'avg_scroll_velocity', 'scroll_consistency', 'tab_switches_5min',
    'mouse_activity', 'session_duration', 'time_of_day',
    'content_length', 'scroll_depth_vs_time', 'goal_relevance', 'is_distracting',
    'tab_switches_per_min', 'idle_seconds', 'direction_changes_per_min',
    'interaction_per_min', 'hovers_per_min', 'passive_browse_score', 'drift_score',
]

DISTRACTING_DOMAINS = ae.load_config()['distracting_domains']


def _get_relevance_score(title, goal):
    return ae._get_relevance_score(title, goal)


def extract(raw):
    normalized = ae.normalize_features(raw)
    url = str(raw.get('current_url', ''))
    url_path = str(raw.get('current_url_path', ''))
    title = str(raw.get('page_title', ''))
    goal = str(raw.get('current_goal', ''))
    normalized['is_distracting'] = 1.0 if ae.is_distracting_in_context(url, url_path) else 0.0
    normalized['goal_relevance'] = _get_relevance_score(title, goal)

    drift = ae.compute_drift(normalized)
    normalized['drift_score'] = drift['drift_score']

    return np.array([normalized.get(k, 0) for k in FEATURE_KEYS], dtype=np.float64)


def normalize(features, stats=None):
    if stats is None:
        return features
    means = np.array([stats.get(k, {}).get('mean', 0) for k in FEATURE_KEYS])
    stds = np.array([stats.get(k, {}).get('std', 1) for k in FEATURE_KEYS])
    stds[stds == 0] = 1
    return (features - means) / stds


def compute_stats(feature_list):
    if not feature_list:
        return {}
    arr = np.array(feature_list)
    stats = {}
    for i, k in enumerate(FEATURE_KEYS):
        stats[k] = {'mean': float(np.mean(arr[:, i])), 'std': float(np.std(arr[:, i]))}
    return stats
