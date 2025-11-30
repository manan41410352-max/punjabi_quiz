from flask import Flask, send_from_directory, request, jsonify
import json
import os
from datetime import datetime
import random
import string
import requests   # for ElevenLabs HTTP calls
import io         # not strictly needed but handy if you later stream audio

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    static_folder=BASE_DIR,       # serve files from this folder
    static_url_path=''            # so /index.html, /data.js, /results.json work
)

RESULTS_FILE = os.path.join(BASE_DIR, 'results.json')
CONTENT_FILE = os.path.join(BASE_DIR, 'content.json')

# Simple backend-side admin/teacher password.
# You can override this by setting the QUIZ_ADMIN_PASSWORD environment variable.
ADMIN_PASSWORD = os.environ.get("QUIZ_ADMIN_PASSWORD", "teacher123")

# Set of admin session tokens that have passed password auth.
valid_admin_tokens = set()

# ======================
# ElevenLabs config
# ======================
ELEVEN_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
ELEVEN_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
ELEVEN_MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")


# ======================
# Helper functions
# ======================
def load_results():
    if not os.path.exists(RESULTS_FILE):
        return []
    try:
        with open(RESULTS_FILE, 'r', encoding='utf-8') as f:
            data = f.read().strip()
            if not data:
                return []
            return json.loads(data)
    except Exception:
        return []


def save_results(results):
    with open(RESULTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def generate_game_code(length=6):
    return "".join(random.choices(string.digits, k=length))


def generate_id(prefix="p"):
    return prefix + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


# ======================
# Core pages & results
# ======================
@app.route('/')
def root():
    # Open index.html
    return send_from_directory(BASE_DIR, 'index.html')


@app.route('/api/save-result', methods=['POST'])
def save_result():
    data = request.get_json()
    if not data:
        return jsonify({'ok': False, 'error': 'No JSON received'}), 400

    # Add server-side timestamp if not present
    if 'timestamp' not in data:
        data['timestamp'] = datetime.utcnow().isoformat() + 'Z'

    results = load_results()
    results.append(data)
    save_results(results)

    return jsonify({'ok': True})


@app.route('/api/results', methods=['GET'])
def get_results():
    results = load_results()
    return jsonify(results)


@app.route('/api/auth/check', methods=['POST'])
def auth_check():
    """Check teacher/admin password on the server side.

    Expects JSON: { "password": "...." }
    Returns: { "ok": true, "token": "..." } or { "ok": false, "error": "..." }
    """
    data = request.get_json(force=True, silent=True) or {}
    pwd = (data.get('password') or '').strip()

    if not pwd:
        return jsonify({'ok': False, 'error': 'No password provided'}), 400

    if pwd != ADMIN_PASSWORD:
        return jsonify({'ok': False, 'error': 'Invalid password'}), 401

    # Generate a simple admin session token and remember it
    token = generate_id('admin')
    valid_admin_tokens.add(token)

    return jsonify({'ok': True, 'token': token})


# =====================
# Live Quiz (Kahoot-style) in-memory backend
# =====================

# In-memory game storage (for simple classroom sessions)
games = {}


@app.route('/live_host')
def live_host():
    """Teacher host page for live quiz"""
    return send_from_directory(BASE_DIR, 'live_host.html')


@app.route('/live_join')
def live_join():
    """Student join page for live quiz"""
    return send_from_directory(BASE_DIR, 'live_join.html')


@app.route('/api/live/create_game', methods=['POST'])
def create_game():
    data = request.get_json(force=True, silent=True) or {}

    # Require a valid admin token from /api/auth/check
    admin_token = data.get('adminToken')
    if not admin_token or admin_token not in valid_admin_tokens:
        return jsonify({'ok': False, 'error': 'Not authorized'}), 403

    class_id = data.get('classId')
    chapter_id = data.get('chapterId')
    host_name = data.get('hostName') or 'Teacher'

    # Generate unique code
    code = None
    for _ in range(10):
        candidate = generate_game_code()
        if candidate not in games:
            code = candidate
            break
    if code is None:
        return jsonify({'ok': False, 'error': 'Could not generate game code'}), 500

    host_token = generate_id('h')
    games[code] = {
        'code': code,
        'classId': class_id,
        'chapterId': chapter_id,
        'createdAt': datetime.utcnow().isoformat() + 'Z',
        'status': 'waiting',  # waiting | in_progress | finished
        'currentQuestionIndex': -1,
        'correctIndex': None,
        'hostToken': host_token,
        'players': {}  # playerId -> {name, score, lastCorrect, answered}
    }

    return jsonify({
        'ok': True,
        'gameCode': code,
        'hostToken': host_token
    })


@app.route('/api/live/join', methods=['POST'])
def join_game():
    data = request.get_json(force=True, silent=True) or {}
    code = (data.get('gameCode') or '').strip()
    name = (data.get('playerName') or '').strip()

    game = games.get(code)
    if not game:
        return jsonify({'ok': False, 'error': 'Game not found'}), 404

    if game['status'] == 'finished':
        return jsonify({'ok': False, 'error': 'Game already finished'}), 400

    if not name:
        name = 'Player'

    player_id = generate_id('p')
    game['players'][player_id] = {
        'name': name,
        'score': 0,
        'lastCorrect': None,
        'answered': False
    }

    return jsonify({
        'ok': True,
        'playerId': player_id,
        'gameCode': code,
        'classId': game['classId'],
        'chapterId': game['chapterId'],
        'status': game['status'],
        'currentQuestionIndex': game['currentQuestionIndex']
    })


@app.route('/api/live/next_question', methods=['POST'])
def next_question():
    data = request.get_json(force=True, silent=True) or {}
    code = (data.get('gameCode') or '').strip()
    host_token = data.get('hostToken')
    q_index = data.get('questionIndex')
    correct_index = data.get('correctIndex')

    game = games.get(code)
    if not game:
        return jsonify({'ok': False, 'error': 'Game not found'}), 404

    if game['hostToken'] != host_token:
        return jsonify({'ok': False, 'error': 'Not authorized'}), 403

    try:
        q_index = int(q_index)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'Invalid question index'}), 400

    try:
        correct_index = int(correct_index)
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'Invalid correct index'}), 400

    game['status'] = 'in_progress'
    game['currentQuestionIndex'] = q_index
    game['correctIndex'] = correct_index

    # Reset answered flags for new question
    for p in game['players'].values():
        p['answered'] = False
        p['lastCorrect'] = None

    return jsonify({'ok': True})


@app.route('/api/live/end_game', methods=['POST'])
def end_game():
    data = request.get_json(force=True, silent=True) or {}
    code = (data.get('gameCode') or '').strip()
    host_token = data.get('hostToken')

    game = games.get(code)
    if not game:
        return jsonify({'ok': False, 'error': 'Game not found'}), 404

    if game['hostToken'] != host_token:
        return jsonify({'ok': False, 'error': 'Not authorized'}), 403

    game['status'] = 'finished'
    return jsonify({'ok': True})


@app.route('/api/live/answer', methods=['POST'])
def submit_answer():
    data = request.get_json(force=True, silent=True) or {}
    code = (data.get('gameCode') or '').strip()
    player_id = data.get('playerId')
    selected = data.get('selectedIndex')

    game = games.get(code)
    if not game:
        return jsonify({'ok': False, 'error': 'Game not found'}), 404

    player = game['players'].get(player_id)
    if not player:
        return jsonify({'ok': False, 'error': 'Player not found'}), 404

    # If question hasn't started
    if game['currentQuestionIndex'] < 0 or game['status'] != 'in_progress':
        return jsonify({'ok': False, 'error': 'Question not active'}), 400

    # If already answered this question, ignore
    if player['answered']:
        return jsonify({'ok': True, 'alreadyAnswered': True, 'score': player['score']})

    try:
        selected = int(selected)
    except (TypeError, ValueError):
        selected = None

    is_correct = (selected == game['correctIndex'])
    player['answered'] = True
    player['lastCorrect'] = bool(is_correct)

    if is_correct:
        # Simple scoring: +1 point per correct answer
        player['score'] += 1

    return jsonify({
        'ok': True,
        'correct': is_correct,
        'score': player['score']
    })


@app.route('/api/live/state', methods=['GET'])
def game_state():
    code = request.args.get('gameCode', '').strip()
    player_id = request.args.get('playerId')  # optional

    game = games.get(code)
    if not game:
        return jsonify({'ok': False, 'error': 'Game not found'}), 404

    players_list = []
    for pid, p in game['players'].items():
        players_list.append({
            'playerId': pid,
            'name': p['name'],
            'score': p['score'],
            'answered': p['answered'],
            'lastCorrect': p['lastCorrect']
        })

    # Sort leaderboard by score desc, then name
    players_list.sort(key=lambda x: (-x['score'], x['name'].lower()))

    you = None
    if player_id and player_id in game['players']:
        p = game['players'][player_id]
        you = {
            'playerId': player_id,
            'name': p['name'],
            'score': p['score'],
            'answered': p['answered'],
            'lastCorrect': p['lastCorrect']
        }

    return jsonify({
        'ok': True,
        'gameCode': code,
        'classId': game['classId'],
        'chapterId': game['chapterId'],
        'status': game['status'],
        'currentQuestionIndex': game['currentQuestionIndex'],
        'players': players_list,
        'you': you
    })


# =====================
# Content management
# =====================
def load_content():
    """Load onboarding content from content.json if it exists."""
    if not os.path.exists(CONTENT_FILE):
        return {}
    try:
        with open(CONTENT_FILE, 'r', encoding='utf-8') as f:
            data = f.read().strip()
            if not data:
                return {}
            return json.loads(data)
    except Exception:
        return {}


def save_content(content):
    """Save onboarding content to content.json."""
    with open(CONTENT_FILE, 'w', encoding='utf-8') as f:
        json.dump(content, f, ensure_ascii=False, indent=2)


@app.route('/api/content', methods=['GET', 'POST'])
def api_content():
    """GET returns current onboarding content; POST saves new content.

    GET  -> returns {} or the current content.json object.
    POST -> expects JSON:
      {
        "password": "teacher123",
        "content": { ... }   # same structure as sample_content.json
      }
    """
    if request.method == 'GET':
        return jsonify(load_content())

    data = request.get_json(force=True, silent=True) or {}
    pwd = (data.get('password') or '').strip()
    if not pwd:
        return jsonify({'ok': False, 'error': 'No password provided'}), 400

    if pwd != ADMIN_PASSWORD:
        return jsonify({'ok': False, 'error': 'Invalid password'}), 401

    content = data.get('content')
    if not isinstance(content, dict):
        return jsonify({'ok': False, 'error': 'content must be an object'}), 400

    try:
        # Light structural validation
        for class_key, cls in content.items():
            if not isinstance(cls, dict):
                raise ValueError(f"{class_key} must be an object")
            if 'chapters' in cls and not isinstance(cls['chapters'], list):
                raise ValueError(f"{class_key}.chapters must be a list")
        save_content(content)
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Invalid structure: {e}'}), 400

    return jsonify({'ok': True})


# =====================
# ElevenLabs TTS endpoint
# =====================
@app.route('/api/tts', methods=['POST'])
def generate_tts():
    """Generate speech audio from text using ElevenLabs and return MP3 bytes."""
    if not ELEVEN_API_KEY:
        print("ERROR: ELEVENLABS_API_KEY not set")
        return jsonify({'error': 'Server misconfigured: ELEVENLABS_API_KEY not set'}), 500

    data = request.get_json(force=True, silent=True) or {}
    text = (data.get('text') or '').strip()

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVEN_VOICE_ID}"

    headers = {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
    }

    # Keep payload minimal so it works on all plans
    payload = {
        "text": text,
        "model_id": ELEVEN_MODEL_ID,
        "voice_settings": {
            "stability": 0.4,
            "similarity_boost": 0.85,
        },
        # If your plan supports it without error, you can try:
        # "language_code": "pan",  # Punjabi
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        print("ElevenLabs status:", resp.status_code)
        print("ElevenLabs response (first 300 chars):", resp.text[:300])
    except requests.RequestException as e:
        print("ERROR contacting ElevenLabs:", e)
        return jsonify({'error': f'Failed to contact ElevenLabs: {e}'}), 502

    if resp.status_code != 200:
        return jsonify({
            'error': 'ElevenLabs TTS failed',
            'status': resp.status_code,
            'details': resp.text,
        }), 502

    audio_bytes = resp.content
    return app.response_class(
        audio_bytes,
        mimetype='audio/mpeg',
        direct_passthrough=True,
    )


if __name__ == '__main__':
    # Run on all interfaces (so phones on Wi-Fi can access)
    app.run(host='0.0.0.0', port=8000, debug=True)
