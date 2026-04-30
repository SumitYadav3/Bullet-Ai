import os
import json
import uuid
import re
import requests
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session
from flask_cors import CORS

# ── App Setup ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev_secret_key_change_in_prod")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
CORS(app, resources={r"/*": {"origins": "*"}})


OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "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")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "meta-llama/llama-3.1-8b-instruct"
SITE_URL = "http://localhost:5000"
SITE_NAME = "AI Resume Bullet Improver"


# ── Session / Rate Limiting ────────────────────────────────────────────────────
@app.before_request
def init_session():
    if "user_id" not in session:
        session["user_id"] = str(uuid.uuid4())
    if "req_times" not in session:
        session["req_times"] = []


def check_rate_limit() -> bool:
    now = datetime.utcnow().timestamp()
    session["req_times"] = [t for t in session.get("req_times", []) if now - t < 60]
    if len(session["req_times"]) >= 15:
        return False
    session["req_times"].append(now)
    session.modified = True
    return True


# ── OpenRouter Helper ──────────────────────────────────────────────────────────
def call_openrouter(system_prompt: str, user_prompt: str, temperature: float = 0.7) -> str:
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": SITE_URL,
        "X-Title": SITE_NAME,
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": 1500,
    }
    try:
        resp = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()
    except requests.exceptions.Timeout:
        raise RuntimeError("AI request timed out. Please try again.")
    except requests.exceptions.HTTPError as e:
        raise RuntimeError(f"AI service error ({resp.status_code}): {e}")
    except Exception as e:
        raise RuntimeError(f"Unexpected error: {e}")


def parse_json_from_response(raw: str) -> dict:
    """Extract and parse JSON from AI response, handling markdown code fences."""
    # Strip markdown code fences
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("```").strip()
    # Find first { to last }
    start = cleaned.find("{")
    end = cleaned.rfind("}") + 1
    if start == -1 or end == 0:
        raise RuntimeError(f"No JSON object found in response. Raw: {cleaned[:300]}")
    try:
        return json.loads(cleaned[start:end])
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Could not parse AI response as JSON: {e}. Raw: {cleaned[:300]}")


# ── AI Helpers ─────────────────────────────────────────────────────────────────
def call_improve(text: str, level: str, role: str) -> dict:
    system_prompt = """You are an expert resume writer and ATS optimization specialist.
Your task is to rewrite the given resume bullet point into 3 powerful, ATS-friendly versions.
Each bullet should start with a strong action verb, include quantifiable metrics where possible, and be concise.

Respond ONLY with a valid JSON object (no markdown, no explanation) in this exact format:
{
  "bullets": ["bullet 1 here", "bullet 2 here", "bullet 3 here"],
  "ats_score": 82,
  "feedback": ["tip 1", "tip 2", "tip 3"]
}"""
    user_prompt = f"""Experience Level: {level}
Role Type: {role}
Original Bullet: {text}

Rewrite this into 3 improved ATS-optimized bullets. Return only JSON."""

    raw = call_openrouter(system_prompt, user_prompt, temperature=0.75)
    result = parse_json_from_response(raw)

    for key in ("bullets", "ats_score", "feedback"):
        if key not in result:
            raise RuntimeError(f"AI response missing key: '{key}'")
    if not isinstance(result["bullets"], list) or len(result["bullets"]) < 1:
        raise RuntimeError("AI returned no bullets.")
    return result


def call_analyze(resume_text: str) -> dict:
    system_prompt = """You are an expert resume reviewer and career coach.
Analyze the provided resume text and identify weak bullet points that lack action verbs, metrics, or clarity.
For each weak bullet, provide an improved version.

Respond ONLY with a valid JSON object (no markdown) in this exact format:
{
  "issues": ["weak bullet 1", "weak bullet 2"],
  "improvements": ["improved version 1", "improved version 2"]
}"""
    user_prompt = f"Resume Text:\n{resume_text}\n\nIdentify weak bullets and return only JSON."
    raw = call_openrouter(system_prompt, user_prompt, temperature=0.6)
    result = parse_json_from_response(raw)
    for key in ("issues", "improvements"):
        if key not in result:
            raise RuntimeError(f"AI response missing key: '{key}'")
    return result


def call_match(resume_text: str, jd_text: str) -> dict:
    system_prompt = """You are an expert ATS (Applicant Tracking System) and technical recruiter.
Analyze how well the provided resume matches the job description.
Calculate a realistic match score from 0 to 100.
Identify up to 6 critical missing keywords from the JD that are absent from the resume.
Provide 3 actionable suggestions to improve the resume for this specific job.

Respond ONLY with a valid JSON object (no markdown) in this exact format:
{
  "match_score": 72,
  "missing_keywords": ["React", "AWS", "Docker"],
  "suggestions": ["Add React experience to your skills section", "Mention any cloud platform usage"]
}"""
    user_prompt = f"Resume:\n{resume_text}\n\nJob Description:\n{jd_text}\n\nAnalyze and return only JSON."
    raw = call_openrouter(system_prompt, user_prompt, temperature=0.3)
    result = parse_json_from_response(raw)
    for key in ("match_score", "missing_keywords", "suggestions"):
        if key not in result:
            raise RuntimeError(f"AI response missing key: '{key}'")
    return result


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/app")
def app_page():
    return render_template("app.html")


@app.route("/improve", methods=["POST"])
def improve():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please wait a minute and try again."}), 429

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    text  = (data.get("text")  or "").strip()
    level = (data.get("level") or "experienced").strip().lower()
    role  = (data.get("role")  or "tech").strip().lower()

    if not text:
        return jsonify({"error": "The 'text' field is required."}), 400
    if len(text) < 10:
        return jsonify({"error": "Please provide a more descriptive bullet point (min 10 chars)."}), 400
    if len(text) > 500:
        return jsonify({"error": "Bullet point too long (max 500 characters)."}), 400
    if level not in {"fresher", "experienced"}:
        return jsonify({"error": "Invalid level. Use 'fresher' or 'experienced'."}), 400
    if role not in {"tech", "non-tech"}:
        return jsonify({"error": "Invalid role. Use 'tech' or 'non-tech'."}), 400

    try:
        result = call_improve(text, level, role)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

    return jsonify(result), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please wait a minute and try again."}), 429

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    resume_text = (data.get("resume") or "").strip()

    if not resume_text:
        return jsonify({"error": "The 'resume' field is required."}), 400
    if len(resume_text) < 50:
        return jsonify({"error": "Please provide more resume text (min 50 chars)."}), 400
    if len(resume_text) > 3000:
        return jsonify({"error": "Resume text too long (max 3000 characters)."}), 400

    try:
        result = call_analyze(resume_text)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

    return jsonify(result), 200


@app.route("/match", methods=["POST"])
def match():
    if not check_rate_limit():
        return jsonify({"error": "Too many requests. Please wait a minute and try again."}), 429

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body must be JSON."}), 400

    resume_text = (data.get("resume") or "").strip()
    jd_text     = (data.get("jd")     or "").strip()

    if not resume_text or not jd_text:
        return jsonify({"error": "Both 'resume' and 'jd' fields are required."}), 400
    if len(resume_text) < 50 or len(jd_text) < 50:
        return jsonify({"error": "Both fields need at least 50 characters."}), 400
    if len(resume_text) > 3000 or len(jd_text) > 3000:
        return jsonify({"error": "Inputs are too long (max 3000 chars each)."}), 400

    try:
        result = call_match(resume_text, jd_text)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502

    return jsonify(result), 200


@app.route("/health")
def health():
    return jsonify({"status": "ok", "model": MODEL}), 200


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
