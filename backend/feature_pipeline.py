import numpy as np
import re

FEATURE_KEYS = ['avg_scroll_velocity', 'scroll_consistency', 'tab_switches_5min', 'mouse_activity', 'session_duration', 'time_of_day', 'content_length', 'scroll_depth_vs_time', 'goal_relevance', 'is_distracting']
DISTRACTING_DOMAINS = ['youtube.com', 'netflix.com', 'twitter.com', 'instagram.com', 'facebook.com', 'reddit.com', 'tiktok.com']

def _get_relevance_score(title, goal):
    if not title or not goal: return 0.0
    t_words = set(re.findall(r'\w+', str(title).lower()))
    g_words = set(re.findall(r'\w+', str(goal).lower()))
    stop_words = {'for', 'and', 'the', 'to', 'a', 'in', 'of', 'on', 'is', 'my', 'how', 'what', 'why', 'with'}
    t_words -= stop_words
    g_words -= stop_words
    if not g_words: return 0.0
    return float(len(t_words.intersection(g_words))) / len(g_words)

def extract(raw):
    url = str(raw.get('current_url', ''))
    title = str(raw.get('page_title', ''))
    goal = str(raw.get('current_goal', ''))
    raw['is_distracting'] = 1.0 if any(d in url for d in DISTRACTING_DOMAINS) else 0.0
    raw['goal_relevance'] = _get_relevance_score(title, goal)
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
