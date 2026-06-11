import unittest
import attention_engine as ae


class TestSignalDrift(unittest.TestCase):
    def test_below_focused_max(self):
        self.assertEqual(ae.signal_drift(5, 8, 20, 40), 0.0)

    def test_at_drifting_threshold(self):
        result = ae.signal_drift(20, 8, 20, 40)
        self.assertAlmostEqual(result, 0.4, places=4)

    def test_at_gone_threshold(self):
        self.assertEqual(ae.signal_drift(40, 8, 20, 40), 1.0)

    def test_mid_gone_range(self):
        result = ae.signal_drift(30, 8, 20, 40)
        self.assertGreater(result, 0.4)
        self.assertLess(result, 1.0)


class TestComputeDrift(unittest.TestCase):
    def _base(self, **overrides):
        features = {
            'current_url': 'docs.google.com',
            'page_title': 'Project notes',
            'current_goal': 'finish homework',
            'avg_scroll_velocity': 3,
            'scroll_consistency': 0.3,
            'tab_switches_per_min': 2,
            'tab_switches_5min': 2,
            'mouse_activity': 8,
            'session_duration': 15,
            'idle_seconds': 5,
            'direction_changes_per_min': 1,
            'interaction_per_min': 8,
            'hovers_per_min': 0,
            'consecutive_drift': 0,
        }
        features.update(overrides)
        return features

    def test_focused_profile(self):
        result = ae.compute_drift(self._base())
        self.assertEqual(result['state'], 'focused')
        self.assertLess(result['drift_score'], 0.34)

    def test_twenty_tabs_per_min_drifting(self):
        result = ae.compute_drift(self._base(
            tab_switches_per_min=20,
            tab_switches_5min=20,
        ))
        self.assertIn(result['state'], ('drifting', 'gone'))
        self.assertGreaterEqual(result['drift_score'], 0.34)
        self.assertGreater(result['components']['tab_switch_rate'], 0.3)

    def test_gone_profile_youtube(self):
        result = ae.compute_drift(self._base(
            current_url='youtube.com',
            page_title='Recommended videos',
            avg_scroll_velocity=18,
            scroll_consistency=0.82,
            tab_switches_per_min=42,
            tab_switches_5min=20,
            mouse_activity=2,
            idle_seconds=90,
            direction_changes_per_min=15,
            interaction_per_min=0.5,
            hovers_per_min=6,
            session_duration=40,
        ))
        self.assertEqual(result['state'], 'gone')
        self.assertGreater(result['drift_score'], 0.64)

    def test_goal_relevance_keeps_focused(self):
        result = ae.compute_drift(self._base(
            current_url='docs.google.com',
            page_title='Homework project notes',
            current_goal='finish homework',
            avg_scroll_velocity=7,
            tab_switches_per_min=10,
        ))
        self.assertEqual(result['state'], 'focused')
        self.assertGreaterEqual(result['goal_relevance'], 0.5)

    def test_idle_contributes_to_drift(self):
        low_idle = ae.compute_drift(self._base(idle_seconds=10))
        high_idle = ae.compute_drift(self._base(idle_seconds=120))
        self.assertGreater(high_idle['drift_score'], low_idle['drift_score'])

    def test_sustained_drift_modifier(self):
        base = ae.compute_drift(self._base(tab_switches_per_min=18))
        sustained = ae.compute_drift(self._base(tab_switches_per_min=18, consecutive_drift=8))
        self.assertGreater(sustained['drift_score'], base['drift_score'])


class TestGeminiHelpers(unittest.TestCase):
    def test_blend_drift_weights_gemini_higher_when_confident(self):
        import gemini_analyzer as ga
        low_conf = ga._blend_drift(0.3, 0.6, 0.6)
        high_conf = ga._blend_drift(0.3, 0.6, 0.85)
        self.assertGreater(high_conf, low_conf)
        self.assertGreater(high_conf, 0.3)

    def test_state_from_drift_thresholds(self):
        import gemini_analyzer as ga
        self.assertEqual(ga._state_from_drift(0.1), 'focused')
        self.assertEqual(ga._state_from_drift(0.5), 'drifting')
        self.assertEqual(ga._state_from_drift(0.8), 'gone')


if __name__ == '__main__':
    unittest.main()
