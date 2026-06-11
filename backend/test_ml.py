import requests
import json

base_url = "http://localhost:5000"

print("1. Checking ML Status...")
try:
    resp = requests.get(f"{base_url}/api/status")
    print("Status:", resp.json())
except Exception as e:
    print("Failed to reach server:", e)

print("\n2. Testing 'Focused' behavior...")
focused_payload = {
    "current_url": "docs.google.com",
    "page_title": "Project notes",
    "current_goal": "finish homework",
    "avg_scroll_velocity": 3,
    "tab_switches_5min": 1,
    "session_duration": 15
}
try:
    resp = requests.post(f"{base_url}/api/predict", json=focused_payload)
    print("Prediction:", json.dumps(resp.json(), indent=2))
except Exception as e:
    print("Failed:", e)

print("\n3. Testing 'Distracted/Gone' behavior...")
distracted_payload = {
    "current_url": "youtube.com",
    "page_title": "Recommended videos",
    "current_goal": "finish homework",
    "avg_scroll_velocity": 18,
    "tab_switches_5min": 10,
    "session_duration": 40
}
try:
    resp = requests.post(f"{base_url}/api/predict", json=distracted_payload)
    print("Prediction:", json.dumps(resp.json(), indent=2))
except Exception as e:
    print("Failed:", e)
