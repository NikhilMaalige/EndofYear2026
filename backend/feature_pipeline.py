import numpy as np

FEATURE_KEYS = ['avg_scroll_velocity', 'scroll_consistency', 'tab_switches_5min', 'mouse_activity', 'session_duration', 'time_of_day', 'content_length', 'scroll_depth_vs_time']

def extract(raw):
    return np.array([raw.get(k, 0) for k in FEATURE_KEYS], dtype=np.float64)

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
