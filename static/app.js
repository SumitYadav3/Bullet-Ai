/* ─────────────────────────────────────────────────────────────
   app.js — ResumeAI Dashboard
   Handles: Tab switching, Improve / Analyze / Match features
   ───────────────────────────────────────────────────────────── */

'use strict';

// ── API endpoints ──────────────────────────────────────────────────────────────
const API = {
  improve: '/improve',
  analyze: '/analyze',
  match:   '/match',
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ══════════════════════════════════════════════════════════════════════════════
function switchTab(tabId) {
  ['improve', 'analyze', 'match'].forEach(id => {
    const btn   = document.getElementById(`tab-btn-${id}`);
    const panel = document.getElementById(`tab-${id}`);
    const isActive = id === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('active', isActive);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════
function setLoading(btnId, on) {
  const btn    = document.getElementById(btnId);
  const text   = document.getElementById(`${btnId}-text`);
  const loader = document.getElementById(`${btnId}-loader`);
  btn.disabled = on;
  text.classList.toggle('hidden', on);
  loader.classList.toggle('hidden', !on);
}

function showError(boxId, msg) {
  const box = document.getElementById(boxId);
  box.textContent = msg;
  box.classList.remove('hidden');
}

function clearError(boxId) {
  const box = document.getElementById(boxId);
  box.textContent = '';
  box.classList.add('hidden');
}

async function callAPI(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

// Score ring helpers
function animateScore(fillId, barId, descId, score, unit = '/100') {
  const fill = document.getElementById(fillId);
  const bar  = document.getElementById(barId);
  const desc = document.getElementById(descId);

  const circumference = 251; // 2π × r=40
  const offset = circumference - (circumference * score / 100);
  fill.style.strokeDashoffset = offset;

  if (bar) { bar.style.width = `${score}%`; }

  let color, label;
  if (score < 50) {
    color = '#dc2626'; label = `Weak${unit === '%' ? ' Match' : ' — Needs Improvement ⚠️'}`;
  } else if (score < 75) {
    color = '#d97706'; label = `Good${unit === '%' ? ' Match' : ' — Mostly ATS-Friendly 🔶'}`;
  } else {
    color = '#16a34a'; label = `Strong${unit === '%' ? ' Match' : ' — Highly ATS-Friendly ✅'}`;
  }

  fill.style.stroke = color;
  if (bar) bar.style.background = color;
  if (desc) desc.textContent = label;
}

// Copy to clipboard helper
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — IMPROVE BULLET
// ══════════════════════════════════════════════════════════════════════════════
const bulletInput  = document.getElementById('bullet-input');
const bulletCount  = document.getElementById('bullet-char-count');

bulletInput.addEventListener('input', () => {
  bulletCount.textContent = `${bulletInput.value.length} / 500`;
});
bulletInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) improveBullet();
});

async function improveBullet() {
  clearError('improve-error');
  const text  = bulletInput.value.trim();
  const level = document.getElementById('level-select').value;
  const role  = document.getElementById('role-select').value;

  if (!text)        return showError('improve-error', 'Please enter a bullet point.');
  if (text.length < 10) return showError('improve-error', 'Bullet point too short (minimum 10 characters).');
  if (text.length > 500) return showError('improve-error', 'Bullet point too long (maximum 500 characters).');

  setLoading('improve-btn', true);
  try {
    const data = await callAPI(API.improve, { text, level, role });
    renderImproveResults(data);
    if (window.innerWidth <= 800) {
      document.getElementById('improve-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    showError('improve-error', err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading('improve-btn', false);
  }
}

function renderImproveResults({ bullets = [], ats_score = 0, feedback = [] }) {
  document.getElementById('improve-placeholder').classList.add('hidden');
  const resultsEl = document.getElementById('improve-results');
  resultsEl.classList.remove('hidden');

  // ATS Score
  document.getElementById('score-value').textContent = ats_score;
  animateScore('score-fill', 'score-bar', 'score-desc', ats_score, '/100');

  // Bullets
  const list = document.getElementById('bullets-list');
  list.innerHTML = '';
  bullets.forEach((b, i) => {
    const li = document.createElement('li');
    li.className = 'bullet-card';
    li.style.animationDelay = `${i * 0.08}s`;
    li.innerHTML = `
      <span class="bullet-num">${i + 1}</span>
      <span class="bullet-text">${escapeHtml(b)}</span>
      <button class="btn-copy-bullet" onclick="copyText('${escapeAttr(b)}', this)">⎘ Copy</button>
    `;
    list.appendChild(li);
  });

  // Feedback
  const fbList = document.getElementById('feedback-list');
  fbList.innerHTML = '';
  feedback.forEach((tip, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = `${i * 0.08}s`;
    li.textContent = tip;
    fbList.appendChild(li);
  });
  const count = document.getElementById('feedback-count');
  if (count) count.textContent = `${feedback.length} tip${feedback.length !== 1 ? 's' : ''}`;
}

function copyAll() {
  const texts = [...document.querySelectorAll('.bullet-text')].map((el, i) => `${i+1}. ${el.textContent}`);
  if (!texts.length) return;
  copyText(texts.join('\n'), document.getElementById('copy-all-btn'));
}

function clearImprove() {
  bulletInput.value = '';
  bulletCount.textContent = '0 / 500';
  clearError('improve-error');
  bulletInput.focus();
}

function resetImprove() {
  clearImprove();
  document.getElementById('improve-results').classList.add('hidden');
  document.getElementById('improve-placeholder').classList.remove('hidden');
  document.getElementById('score-fill').style.strokeDashoffset = '251';
  document.getElementById('score-bar').style.width = '0';
  document.getElementById('bullets-list').innerHTML = '';
  document.getElementById('feedback-list').innerHTML = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — ANALYZE RESUME
// ══════════════════════════════════════════════════════════════════════════════
const resumeInput = document.getElementById('resume-input');
const resumeCount = document.getElementById('resume-char-count');

resumeInput.addEventListener('input', () => {
  resumeCount.textContent = `${resumeInput.value.length} / 3000`;
});
resumeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyzeResume();
});

async function analyzeResume() {
  clearError('analyze-error');
  const resume = resumeInput.value.trim();

  if (!resume)          return showError('analyze-error', 'Please paste your resume text.');
  if (resume.length < 50)  return showError('analyze-error', 'Please provide more resume text (minimum 50 characters).');
  if (resume.length > 3000) return showError('analyze-error', 'Resume text too long (maximum 3000 characters).');

  setLoading('analyze-btn', true);
  try {
    const data = await callAPI(API.analyze, { resume });
    renderAnalyzeResults(data);
    if (window.innerWidth <= 800) {
      document.getElementById('analyze-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    showError('analyze-error', err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading('analyze-btn', false);
  }
}

function renderAnalyzeResults({ issues = [], improvements = [] }) {
  document.getElementById('analyze-placeholder').classList.add('hidden');
  document.getElementById('analyze-results').classList.remove('hidden');

  const count = document.getElementById('analyze-count');
  if (count) count.textContent = `${issues.length} weakness${issues.length !== 1 ? 'es' : ''}`;

  const list = document.getElementById('analysis-list');
  list.innerHTML = '';

  if (issues.length === 0) {
    list.innerHTML = '<p style="color: var(--gray-500); font-size: .9rem; padding: 12px 0;">🎉 Your resume looks strong! No major weak bullets detected.</p>';
    return;
  }

  issues.forEach((issue, i) => {
    const improved = improvements[i] || 'N/A';
    const card = document.createElement('div');
    card.className = 'analysis-card';
    card.style.animationDelay = `${i * 0.08}s`;
    card.innerHTML = `
      <div class="analysis-card-weak">
        <div class="analysis-tag analysis-tag-weak">❌ Weak Bullet</div>
        <p class="analysis-text">${escapeHtml(issue)}</p>
      </div>
      <div class="analysis-card-improved">
        <div class="analysis-tag analysis-tag-improved">✅ Suggested Improvement</div>
        <p class="analysis-text">${escapeHtml(improved)}</p>
      </div>
    `;
    list.appendChild(card);
  });
}

function clearAnalyze() {
  resumeInput.value = '';
  resumeCount.textContent = '0 / 3000';
  clearError('analyze-error');
  resumeInput.focus();
}

function resetAnalyze() {
  clearAnalyze();
  document.getElementById('analyze-results').classList.add('hidden');
  document.getElementById('analyze-placeholder').classList.remove('hidden');
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — JOB DESCRIPTION MATCH
// ══════════════════════════════════════════════════════════════════════════════
async function matchJob() {
  clearError('match-error');
  const resume = document.getElementById('match-resume-input').value.trim();
  const jd     = document.getElementById('match-jd-input').value.trim();

  if (!resume || !jd)  return showError('match-error', 'Please provide both resume text and job description.');
  if (resume.length < 50 || jd.length < 50) return showError('match-error', 'Both fields need at least 50 characters.');
  if (resume.length > 3000 || jd.length > 3000) return showError('match-error', 'Inputs too long (max 3000 chars each).');

  setLoading('match-btn', true);
  try {
    const data = await callAPI(API.match, { resume, jd });
    renderMatchResults(data);
    if (window.innerWidth <= 800) {
      document.getElementById('match-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    showError('match-error', err.message || 'Something went wrong. Please try again.');
  } finally {
    setLoading('match-btn', false);
  }
}

function renderMatchResults({ match_score = 0, missing_keywords = [], suggestions = [] }) {
  document.getElementById('match-placeholder').classList.add('hidden');
  document.getElementById('match-results').classList.remove('hidden');

  // Score
  document.getElementById('match-score-value').textContent = match_score;
  animateScore('match-score-fill', 'match-score-bar', 'match-score-desc', match_score, '%');

  // Missing keywords
  const kwWrap = document.getElementById('keywords-list');
  kwWrap.innerHTML = '';
  if (missing_keywords.length === 0) {
    kwWrap.innerHTML = '<p style="font-size:.85rem;color:var(--green);">🎉 No major keywords missing!</p>';
  } else {
    missing_keywords.forEach((kw, i) => {
      const chip = document.createElement('span');
      chip.className = 'keyword-chip';
      chip.style.animationDelay = `${i * 0.06}s`;
      chip.textContent = kw;
      kwWrap.appendChild(chip);
    });
  }

  // Suggestions
  const sugList = document.getElementById('suggestions-list');
  sugList.innerHTML = '';
  if (suggestions.length === 0) {
    sugList.innerHTML = '<li>Your resume is well-aligned with this job description.</li>';
  } else {
    suggestions.forEach((s, i) => {
      const li = document.createElement('li');
      li.style.animationDelay = `${i * 0.06}s`;
      li.textContent = s;
      sugList.appendChild(li);
    });
  }
}

function clearMatch() {
  document.getElementById('match-resume-input').value = '';
  document.getElementById('match-jd-input').value = '';
  clearError('match-error');
  document.getElementById('match-resume-input').focus();
}

function resetMatch() {
  clearMatch();
  document.getElementById('match-results').classList.add('hidden');
  document.getElementById('match-placeholder').classList.remove('hidden');
  document.getElementById('match-score-fill').style.strokeDashoffset = '251';
  document.getElementById('match-score-bar').style.width = '0';
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '\\n');
}
