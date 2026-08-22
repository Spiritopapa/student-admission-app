/**
 * Assessment Taking Module (Student)
 * Listens for published assessments, starts a server-randomized attempt,
 * lets the student answer, submits, and shows instant self-marking results.
 */

import { getEl, showMessage, clearMessage, setLoading, openPrintWindow } from './utils.js';
import { esc, buildPrintShell } from './assessment-shared.js';

let supabaseClient = null;
let _studentId = null;
let _runningTimer = null;
let _current = null; // active attempt session
let _lastResult = null; // rendered result, used for printing

let studentRecord = null; // matched application record

export function initAssessmentTaking(supabase) {
  supabaseClient = supabase;
}

async function getStudentId() {
  if (_studentId) return _studentId;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  const { data: app } = await supabaseClient.from('applications').select('student_id, class_applying').eq('user_id', user.id).maybeSingle();
  studentRecord = app || null;
  _studentId = app?.student_id || null;
  return _studentId;
}

// ================================================================
// Main entry: render the list of available/past assessments
// ================================================================
export async function loadStudentAssessments() {
  const container = getEl('studentAssessmentsList');
  const results = getEl('studentAssessResults');
  if (!container) return;
  clearTimer();
  _current = null;
  if (results) results.innerHTML = '';
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><span class="spinner"></span> Loading assessments...</div>';

  const studentId = await getStudentId();
  if (!studentId) {
    container.innerHTML = '<div class="assessment-launch-hero"><p style="color:var(--text-muted);">No admission record found. Contact your administrator.</p></div>';
    return;
  }

  // Published, active assessments visible to this student (RLS-scoped by class/school)
  const { data: assessments } = await supabaseClient
    .from('assessments')
    .select('*')
    .eq('is_published', true)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  const list = assessments || [];
  if (!list.length) {
    container.innerHTML = '<div class="assessment-launch-hero"><div style="font-size:3rem;">🎯</div><h3>No Assessments Available</h3><p style="color:var(--text-muted);">Your teacher has not published any assessments for your class yet. Check back soon.</p></div>';
    return;
  }

  // Past attempts for this student (safe summary via SECURITY DEFINER RPC)
  const { data } = await supabaseClient.rpc('get_my_assessment_summaries');
  const attempts = Array.isArray(data) ? data : [];
  const attemptMap = Object.fromEntries(attempts.map((a) => [a.assessment_id, a]));

  const cardHtml = (a) => {
    const att = attemptMap[a.id];
    let statusHtml, actionHtml;
    if (!att) {
      statusHtml = '<span class="score-chip untaken">Not started</span>';
      actionHtml = `<button type="button" class="btn btn-primary" onclick="beginStudentAssessment('${a.id}')">▶ Start</button>`;
    } else if (!att.is_submitted) {
      statusHtml = '<span class="score-chip untaken">In progress</span>';
      actionHtml = `<button type="button" class="btn btn-primary" onclick="beginStudentAssessment('${a.id}')">▶ Resume</button>`;
    } else {
      statusHtml = att.status === 'passed' ? '<span class="score-chip passed">Passed</span>' : '<span class="score-chip failed">Failed</span>';
      actionHtml = `<span style="font-size:0.9rem;font-weight:700;color:var(--text);">${att.score}/${att.total_marks} (${att.score_percentage}%)</span>
        <button type="button" class="btn btn-secondary" onclick="viewStudentAssessmentResult('${a.id}')">📋 Review</button>`;
    }
    return `<div class="qa-card assessment-item">
      <div class="qa-card-header">
        <div>
          <strong style="font-size:1.05rem;">${esc(a.title)}</strong>
          <div class="qa-meta">${esc(a.subject)}${a.class_name ? ' • ' + esc(a.class_name) : ''} · 🎯 ${a.question_count} questions · ⏱ ${a.duration_minutes || '—'} min · Pass ${a.pass_percentage}%</div>
          ${a.description ? `<div class="qa-meta">${esc(a.description)}</div>` : ''}
        </div>
        <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">${statusHtml}${actionHtml}</div>
      </div>
    </div>`;
  };

  container.innerHTML = list.map(cardHtml).join('');
}

// ================================================================
// Start / resume an attempt via the secure server RPC
// ================================================================
window.beginStudentAssessment = async function (assessmentId) {
  const btn = event && event.target;
  const results = getEl('studentAssessResults');
  if (results) results.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><span class="spinner"></span> Preparing your randomised assessment...</div>';
  results?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const { data, error } = await supabaseClient.rpc('start_assessment_attempt', { p_assessment_id: assessmentId });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    if (data.status === 'completed') {
      // Already submitted: show existing result
      renderTakenView('completed', null, data);
      return;
    }
    _current = {
      attemptId: data.attempt_id,
      title: data.title,
      subject: data.subject,
      description: data.description,
      durationMinutes: data.duration_minutes,
      passPercentage: data.pass_percentage,
      totalMarks: data.total_marks,
      questions: data.questions || [],
      answers: {},
    };
    renderTakingView();
  } catch (err) {
    if (results) results.innerHTML = `<div class="assessment-launch-hero" style="padding:1.5rem;"><p style="color:#b91c1c;">${esc(err.message)}</p></div>`;
  }
};
function renderTakingView() {
  const results = getEl('studentAssessResults');
  const c = _current;
  if (!results || !c) return;

  const answered = Object.keys(c.answers).length;
  const progress = Math.round((answered / Math.max(1, c.questions.length)) * 100);

  results.innerHTML = `
    <div class="assessment-progress">
      <div><strong>${esc(c.title)}</strong><div class="qa-meta">${esc(c.subject || '')} · ${c.questions.length} questions · Pass ${c.passPercentage}%</div></div>
      <div style="display:flex;gap:0.6rem;align-items:center;"><span style="font-size:0.82rem;color:var(--text-muted);">${answered}/${c.questions.length} answered</span><span class="assessment-timer" id="studentAssessTimer"></span></div>
    </div>
    <div style="height:8px;background:var(--border);border-radius:999px;overflow:hidden;margin-bottom:1rem;"><div id="studentAssessProgress" style="height:100%;width:${progress}%;background:var(--primary);transition:width .2s;"></div></div>
    <div class="assess-nav-pills" id="studentAssessPalette"></div>
    <div id="studentAssessQuestionArea">${c.questions.map((q, i) => questionBlock(q, i)).join('')}</div>
    <div style="text-align:center;margin-top:1rem;"><button type="button" class="btn btn-primary btn-full" id="btnStudentAssessSubmit" onclick="submitStudentAssessment()">✅ Submit Assessment</button></div>`;

  const palette = getEl('studentAssessPalette');
  if (palette) {
    palette.innerHTML = c.questions.map((q, i) => `
      <button type="button" style="width:34px;height:34px;border:1px solid ${c.answers[q.id] ? 'var(--primary)' : 'var(--border)'};background:${c.answers[q.id] ? 'var(--primary-light)' : 'rgba(255,255,255,0.6)'};border-radius:8px;font-size:0.8rem;cursor:pointer;" onclick="scrollToStudentQuestion(${i})">${i + 1}</button>`).join('');
  }

  startTimer(c.durationMinutes);
}

function questionBlock(q, i) {
  const c = _current || {};
  const chosen = (c.answers || {})[q.id] || '';
  const options = (q.options || []).map((o) => `
    <label class="answer-option ${chosen === o.key ? 'selected' : ''}" onclick="pickStudentAnswer('${q.id}','${o.key}',${i})">
      <span class="option-letter">${esc(o.key)}</span><span>${esc(o.text)}</span>
    </label>`).join('');
  return `<div class="question-block" id="studentQBlock-${i}"><div class="question-text">${i + 1}. ${esc(q.question_text)}</div><div>${options}</div></div>`;
}

window.pickStudentAnswer = function (qid, key, idx) {
  if (!_current) return;
  _current.answers[qid] = key;
  const progressEl = getEl('studentAssessProgress');
  const answered = Object.keys(_current.answers).length;
  if (progressEl) progressEl.style.width = Math.round((answered / Math.max(1, _current.questions.length)) * 100) + '%';
  const q = _current.questions[idx];
  const block = getEl('studentQBlock-' + idx);
  if (block && q) {
    block.innerHTML = `<div class="question-text">${idx + 1}. ${esc(q.question_text)}</div>` +
      (q.options || []).map((o) => `<label class="answer-option ${_current.answers[q.id] === o.key ? 'selected' : ''}" onclick="pickStudentAnswer('${q.id}','${o.key}',${idx})"><span class="option-letter">${esc(o.key)}</span><span>${esc(o.text)}</span></label>`).join('');
  }
  const paletteBtn = document.querySelector(`#studentAssessPalette button:nth-child(${idx + 1})`);
  if (paletteBtn) {
    paletteBtn.style.borderColor = 'var(--primary)';
    paletteBtn.style.background = 'var(--primary-light)';
  }
};

window.scrollToStudentQuestion = function (idx) {
  const block = getEl('studentQBlock-' + idx);
  if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
// ================================================================
// Timer
// ================================================================
function startTimer(minutes) {
  clearTimer();
  const total = Math.max(1, parseInt(minutes, 10) || 30) * 60;
  let remaining = total;
  const el = getEl('studentAssessTimer');
  const tick = () => {
    if (!el) return;
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    el.textContent = '⏱ ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (remaining <= 120) el.classList.add('warning');
    if (remaining <= 0) { clearTimer(); submitStudentAssessment(true); return; }
    remaining--;
  };
  tick();
  _runningTimer = setInterval(tick, 1000);
}

function clearTimer() {
  if (_runningTimer) { clearInterval(_runningTimer); _runningTimer = null; }
}

// ================================================================
// Submit (auto or manual)
// ================================================================
window.submitStudentAssessment = async function (auto) {
  if (!_current) return;
  if (!auto) {
    const answered = Object.keys(_current.answers).length;
    if (answered < _current.questions.length) {
      const leftover = _current.questions.length - answered;
      if (!confirm(`You still have ${leftover} unanswered question${leftover === 1 ? '' : 's'}. Submit anyway?`)) return;
    }
  }
  const btn = getEl('btnStudentAssessSubmit');
  if (btn) setLoading(btn, true, 'Marking...');
  try {
    const { data, error } = await supabaseClient.rpc('submit_assessment_attempt', {
      p_attempt_id: _current.attemptId,
      p_answers: _current.answers,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    clearTimer();
    const wasTitle = _current ? _current.title : '';
    const wasSubject = _current ? _current.subject : '';
    const wasPassPct = _current ? _current.passPercentage : 50;
    _current = null;
    renderTakenView('submitted', data, null, { title: wasTitle, subject: wasSubject, passPercentage: wasPassPct });
    await reloadStudentAssessmentList();
  } catch (err) {
    if (btn) setLoading(btn, false);
    alert('Submission error: ' + err.message);
  }
};

async function reloadStudentAssessmentList() {
  const container = getEl('studentAssessmentsList');
  if (!container) return;
  const { data: assessments } = await supabaseClient.from('assessments').select('*').eq('is_published', true).eq('is_active', true).order('created_at', { ascending: false });
  const { data } = await supabaseClient.rpc('get_my_assessment_summaries');
  const attempts = Array.isArray(data) ? data : [];
  const attemptMap = Object.fromEntries(attempts.map((a) => [a.assessment_id, a]));
  const list = assessments || [];
  container.innerHTML = list.map((a) => {
    const att = attemptMap[a.id];
    let statusHtml, actionHtml;
    if (!att) {
      statusHtml = '<span class="score-chip untaken">Not started</span>';
      actionHtml = `<button type="button" class="btn btn-primary" onclick="beginStudentAssessment('${a.id}')">▶ Start</button>`;
    } else if (!att.is_submitted) {
      statusHtml = '<span class="score-chip untaken">In progress</span>';
      actionHtml = `<button type="button" class="btn btn-primary" onclick="beginStudentAssessment('${a.id}')">▶ Resume</button>`;
    } else {
      statusHtml = att.status === 'passed' ? '<span class="score-chip passed">Passed</span>' : '<span class="score-chip failed">Failed</span>';
      actionHtml = `<span style="font-weight:700;">${att.score}/${att.total_marks} (${att.score_percentage}%)</span><button type="button" class="btn btn-secondary" onclick="viewStudentAssessmentResult('${a.id}')">📋 Review</button>`;
    }
    return `<div class="qa-card assessment-item"><div class="qa-card-header"><div><strong>${esc(a.title)}</strong>${a.description ? '<div class="qa-meta">' + esc(a.description) + '</div>' : ''}</div><div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">${statusHtml}${actionHtml}</div></div></div>`;
  }).join('');
}
// ================================================================
// Result / review view
// ================================================================
function renderTakenView(kind, data, existing, prev) {
  const results = getEl('studentAssessResults');
  if (!results) return;

  _lastResult = {
    title: (prev && prev.title) || (existing && existing.title) || 'Assessment',
    score: data.score,
    total: data.total_marks,
    pct: data.score_percentage,
    passed: kind === 'completed' ? (existing.status_display === 'passed') : data.passed,
    review: data.review || [],
    subject: (prev && prev.subject) || (existing && existing.title) || '',
    passPercentage: (prev && prev.passPercentage) || (existing && existing.pass_percentage) || 50,
  };

  const score = data.score;
  const total = data.total_marks;
  const pct = data.score_percentage;
  const passed = kind === 'completed' ? (existing.status_display === 'passed') : data.passed;
  const title = prev?.title || 'Assessment';

  const scoreChip = kind === 'completed'
    ? (existing.status_display === 'passed' ? '<span class="score-chip passed">Passed</span>' : '<span class="score-chip failed">Failed</span>')
    : (passed ? '<span class="score-chip passed">Passed</span>' : '<span class="score-chip failed">Failed</span>');

  const reviewRows = (data.review || []).map((r, i) => {
    const optionsHtml = (r.options || []).map((o) => {
      let cls = 'review-option answer-option';
      let verdict = '';
      if (o.text === r.correct_text) cls += ' correct-answer';
      if (r.chosen && o.key === r.chosen && r.chosen_text !== r.correct_text) cls += ' wrong-choice';
      if (r.chosen && o.key === r.chosen) {
        const isRight = r.chosen_text === r.correct_text;
        verdict = `<span class="verdict">${isRight ? '✓' : '✗'}</span>`;
      }
      return `<div class="${cls}"><span class="option-letter">${esc(o.key)}</span><span style="flex:1">${esc(o.text)}</span>${verdict}</div>`;
    }).join('');

    const correctBadge = r.correct ? '<span class="correct-tag">✓ Correct</span>' : '<span class="pub-badge failed" style="background:rgba(239,68,68,0.15);color:#b91c1c;">✗ Wrong</span>';
    return `<div class="question-block"><div class="question-text">${i + 1}. ${esc(r.question_text)}</div>${optionsHtml}<div class="qa-meta" style="margin-top:0.5rem;">${correctBadge}${r.chosen_text ? ' <span>Your answer: <strong>' + esc(r.chosen_text) + '</strong></span>' : '<span>Not answered</span>'} <span>Correct answer: <strong>' + esc(r.correct_text) + '</strong></span></div>${r.explanation ? '<div class="qa-meta">💡 ' + esc(r.explanation) + '</div>' : ''}</div>`;
  }).join('');

  results.innerHTML = `
    <div class="assessment-launch-hero" style="padding:1.5rem;">
      <div style="font-size:3rem;">${passed ? '🎉' : '📖'}</div>
      <h3 style="color:var(--text);">${passed ? 'Congratulations! You passed.' : 'Assessment Complete'}</h3>
      <p class="subtitle">${esc(title)}</p>
      <div style="display:inline-block;margin-top:0.75rem;font-size:2rem;font-weight:800;color:${passed ? '#065f46' : '#b91c1c'};">${score}/${total} • ${pct}%</div>
      <div style="margin-top:0.5rem;">${scoreChip}</div>
    </div>
    <div style="margin-top:1rem;"><h3 style="margin-bottom:0.5rem;">📋 Review your answers</h3>${reviewRows}</div>
    <div style="text-align:center;margin-top:1rem;"><button type="button" class="btn btn-primary" onclick="printStudentAssessmentResult()">🖨️ Print Result</button> <button type="button" class="btn btn-secondary" onclick="loadStudentAssessments()">← Back to Assessments</button></div>`;
}

// ================================================================
// Review an already-submitted attempt
// ================================================================
window.viewStudentAssessmentResult = async function (attemptId) {
  const results = getEl('studentAssessResults');
  if (results) results.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><span class="spinner"></span> Loading result...</div>';
  try {
    const { data, error } = await supabaseClient.rpc('get_my_assessment_review', { p_attempt_id: attemptId });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    renderTakenView('completed', {
      score: data.score,
      total_marks: data.total_marks,
      score_percentage: data.score_percentage,
      review: data.review || [],
    }, { status_display: data.status }, { title: data.title || 'Assessment' });
  } catch (err) {
    if (results) results.innerHTML = `<div class="assessment-launch-hero"><p style="color:#b91c1c;">${esc(err.message)}</p></div>`;
  }
};
// Expose for inline onclick usage and cross-module refresh
window.loadStudentAssessments = loadStudentAssessments;
// ================================================================
// Print a completed assessment result / review
// ================================================================
window.printStudentAssessmentResult = function () {
  if (!_lastResult) { alert('No result to print. View a completed assessment result first.'); return; }
  const r = _lastResult;

  const statusBadge = r.passed
    ? '<span class="to-badge s">Passed</span>'
    : '<span class="to-badge f">Failed</span>';

  const reviewHtml = r.review.map((q, i) => {
    const opts = (q.options || []).map((o) => {
      let cls = '';
      let suffix = '';
      if (o.text === q.correct_text) { cls = ' right'; suffix = ' ✓'; }
      if (q.chosen && o.key === q.chosen && q.chosen_text !== q.correct_text) { cls = ' wrong'; suffix = ' ✗ (your answer)'; }
      else if (q.chosen && o.key === q.chosen && q.chosen_text === q.correct_text) suffix = ' ✓ (your answer)';
      return `<div class="opt${cls}"><b>${esc(o.key)}.</b> ${esc(o.text)}${suffix}</div>`;
    }).join('');
    const yourAnswer = q.chosen_text ? esc(q.chosen_text) : 'Not answered';
    const verdict = q.correct ? '<span class="right">Correct</span>' : '<span class="wrong">Wrong</span>';
    return `<div class="answer-row"><div class="q">Q${i + 1}. ${esc(q.question_text)}</div>${opts}<div style="margin-top:0.4rem;font-size:0.85rem;">${verdict} &nbsp;·&nbsp; Your answer: <strong>${yourAnswer}</strong> &nbsp;·&nbsp; Correct: <strong>${esc(q.correct_text)}</strong></div>${q.explanation ? '<div style="margin-top:0.3rem;font-size:0.85rem;color:#475569;">💡 ' + esc(q.explanation) + '</div>' : ''}</div>`;
  }).join('') || '<p style="color:#64748b;">No review available.</p>';

  const body = `
    <div class="ph"><h2>Assessment Result</h2><h3>${esc(r.title)}</h3><p>${esc(r.subject || '')} · Pass mark: ${r.passPercentage}%</p></div>
    <div class="score-hero">
      <div class="big ${r.passed ? 'rs-passed' : 'rs-failed'}">${r.score}/${r.total} · ${r.pct}%</div>
      <div class="meta">Score: ${r.score}/${r.total} &nbsp;|&nbsp; Percentage: ${r.pct}% &nbsp;|&nbsp; Result: ${statusBadge}</div>
    </div>
    <h3 style="margin:1rem 0 0.5rem;">Review of Answers</h3>
    ${reviewHtml}`;

  const html = buildPrintShell(`Assessment Result - ${r.title}`, body);
  const win = openPrintWindow(html, `Assessment Result - ${r.title}`, 780, 800);
  if (win && typeof win.focus === 'function') { try { win.focus(); } catch (e) { /* noop */ } }
};