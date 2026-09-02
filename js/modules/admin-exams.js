/**
 * Admin Exams Module - Exam management, score entry, rankings, report cards
 */

import { getEl, showMessage, clearMessage, setLoading, buildStudentName, formatDate, getTermDisplay, getGrade, getTeacherRemarks, getHeadTeacherRemarks, getSubjectGrade, getPerformanceLevel, collectStyles, openPrintWindow, parseCSVLine, getCurrentSchoolId } from './utils.js';
import { getGradeForScore, getGradingScaleHTML, fetchSchoolGrades } from './admin-grading.js';

let supabaseClient = null;
let currentExamWorkspace = { examId: null, classVal: null };
let examSheetCache = [];

export function initAdminExams(supabase) {
  supabaseClient = supabase;
}

export function setupExamListeners() {
  getEl('adminExamsSearch')?.addEventListener('input', renderExamsTable);
  getEl('addExamBtn')?.addEventListener('click', () => {
    getEl('examEditId').value = '';
    getEl('examForm').reset();
    getEl('examFormSection').open = true;
  });
  getEl('examForm')?.addEventListener('submit', saveExam);
  getEl('btnLoadExamResults')?.addEventListener('click', toggleExamWorkspace);
  getEl('examSelect')?.addEventListener('change', handleExamSelectChange);
  getEl('examSubjectClass')?.addEventListener('change', handleExamClassChange);
  getEl('btnAddExamSubject')?.addEventListener('click', addExamSubject);
  getEl('btnLoadScoreSheet')?.addEventListener('click', loadScoreSheetTab);
  getEl('btnSaveAllResults')?.addEventListener('click', saveAllResults);
  getEl('btnAutoRank')?.addEventListener('click', generateRankings);
  getEl('btnExportCSV')?.addEventListener('click', exportCSV);
  getEl('btnImportCSV')?.addEventListener('click', () => getEl('csvImportInput')?.click());
  getEl('csvImportInput')?.addEventListener('change', importCSV);
  getEl('btnPreviewReport')?.addEventListener('click', previewReportCard);
  getEl('btnPrintReport')?.addEventListener('click', printReportCard);
  getEl('btnPrintReportCards')?.addEventListener('click', () => {
    const classFilter = getEl('examSubjectClass')?.value;
    if (!classFilter) { alert('Please select a specific class from the "Select Class" filter above first.'); return; }
    currentExamWorkspace.classVal = classFilter;
    const reportTab = document.querySelector('.exam-tab[data-etab="reportcard"]');
    if (reportTab) reportTab.click();
    setTimeout(batchPrintReportCards, 500);
  });
  getEl('btnBatchPrintCards')?.addEventListener('click', () => {
    const classFilter = getEl('reportClassFilter')?.value;
    if (!classFilter) { alert('Please select a class to batch print.'); return; }
    currentExamWorkspace.classVal = classFilter;
    batchPrintReportCards();
  });

  // Exam tab switching
  document.querySelectorAll('.exam-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.exam-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-etab');
      document.querySelectorAll('.exam-tab-content').forEach(el => el.style.display = 'none');
      const target = getEl('examTab-' + tab);
      if (target) target.style.display = 'block';
      if (tab === 'scoresheet') loadScoreSheet();
      if (tab === 'rankings') generateRankings();
      if (tab === 'reportcard') loadReportStudents();
      if (tab === 'overallscores') loadOverallScores();
    });
  });
}

// ================================================================
// Exams Table
// ================================================================

export async function renderExamsTable() {
  const schoolId = await getCurrentSchoolId();
  let examsQuery = supabaseClient.from('exams').select('*');
  if (schoolId) examsQuery = examsQuery.eq('school_id', schoolId);
  const { data, error } = await examsQuery.order('created_at', { ascending: false });
  if (error) { console.error('Load exams error:', error); return; }
  let items = data || [];
  const search = (getEl('adminExamsSearch')?.value || '').toLowerCase();
  if (search) items = items.filter((ex) => ex.name.toLowerCase().includes(search) || ex.academic_year.toLowerCase().includes(search));
  const tbody = getEl('adminExamsBody');
  const noEl = getEl('adminNoExams');
  if (!tbody) return;
  if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  if (noEl) noEl.style.display = 'none';
  const statusBadge = (active) => active ? '<span class="badge-confirmed">Active</span>' : '<span class="badge-unconfirmed">Inactive</span>';
  tbody.innerHTML = items.map((ex) => `<tr><td><strong>${ex.name}</strong></td><td>${ex.academic_year}</td><td>${ex.term}</td><td>${ex.start_date || '-'}</td><td>${ex.end_date || '-'}</td><td>${statusBadge(ex.is_active)}</td><td><button class="action-btn confirm" onclick="editExam('${ex.id}')">Edit</button><button class="action-btn danger" onclick="deleteExam('${ex.id}')">Delete</button></td></tr>`).join('');
}

window.editExam = async function (id) {
  try {
    const { data: exam, error } = await supabaseClient.from('exams').select('*').eq('id', id).single();
    if (error) throw error;
    if (!exam) { alert('Exam not found.'); return; }
    getEl('examEditId').value = exam.id;
    getEl('examName').value = exam.name || '';
    getEl('examAcademicYear').value = exam.academic_year || '';
    getEl('examTerm').value = exam.term || 'First';
    getEl('examStart').value = exam.start_date || '';
    getEl('examEnd').value = exam.end_date || '';
    getEl('examClosingDate').value = exam.closing_date || '';
    getEl('examReopeningDate').value = exam.reopening_date || '';
    getEl('examActive').value = exam.is_active ? 'true' : 'false';
    getEl('examFormSection').open = true;
    getEl('examFormSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    alert('Error loading exam: ' + err.message);
    console.error('Edit exam error:', err);
  }
};

window.deleteExam = async function (id) {
  if (!confirm('Delete this exam?')) return;
  const { error } = await supabaseClient.from('exams').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await renderExamsTable();
};

async function saveExam(e) {
  e.preventDefault();
  clearMessage('examMessage');
  const btn = getEl('examSubmitBtn');
  setLoading(btn, true, 'Saving...');
  const editId = getEl('examEditId').value;
  const payload = {
    name: getEl('examName').value.trim(),
    academic_year: getEl('examAcademicYear').value.trim(),
    term: getEl('examTerm').value,
    start_date: getEl('examStart').value || null,
    end_date: getEl('examEnd').value || null,
    closing_date: getEl('examClosingDate').value || null,
    reopening_date: getEl('examReopeningDate').value || null,
    is_active: getEl('examActive').value === 'true',
    school_id: await getCurrentSchoolId()
  };
  try {
    if (editId) {
      const { error } = await supabaseClient.from('exams').update(payload).eq('id', editId);
      if (error) throw error;
      showMessage('examMessage', 'Exam updated.', 'success');
    } else {
      const { error } = await supabaseClient.from('exams').insert([payload]);
      if (error) throw error;
      showMessage('examMessage', 'Exam created.', 'success');
    }
    getEl('examForm').reset();
    getEl('examEditId').value = '';
    await renderExamsTable();
  } catch (err) { showMessage('examMessage', 'Error: ' + err.message, 'error'); }
  finally { setLoading(btn, false, 'Save Exam'); }
}

// ================================================================
// Exam Workspace
// ================================================================

async function toggleExamWorkspace() {
  const ws = getEl('examWorkspace');
  if (!ws) return;
  const isShowing = ws.style.display === 'none' || ws.style.display === '';
  ws.style.display = isShowing ? 'block' : 'none';
  if (isShowing) {
    await populateSubjectSelect(true);
    await loadExamSelects();
  }
}

async function loadExamSelects() {
  try {
    const schoolId = await getCurrentSchoolId();
    let examsQuery = supabaseClient.from('exams').select('id,name');
    if (schoolId) examsQuery = examsQuery.eq('school_id', schoolId);
    examsQuery = examsQuery.order('created_at', { ascending: false });
    const { data: exams } = await examsQuery;
    const populate = (sel, val) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">— Select Exam —</option>' + (exams || []).map(e => `<option value="${e.id}">${e.name}</option>`).join('');
      if (val) sel.value = val;
    };
    populate(getEl('examSelect'), currentExamWorkspace.examId);
    populate(getEl('adminResultExam'), currentExamWorkspace.examId);
    await populateClassFilter(getEl('examSubjectClass'));
    await populateClassFilter(getEl('adminResultClass'));
  } catch (err) { console.error('Failed to load exam selects:', err); }
}

async function populateClassFilter(sel) {
  if (!sel) return;
  try {
    const { getCurrentSchoolId } = await import('./utils.js');
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('classes').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data: classes } = await query;
    sel.innerHTML = '<option value="">— All Classes —</option>' + (classes || []).map(c => `<option>${c.name}</option>`).join('');
    if (currentExamWorkspace.classVal) sel.value = currentExamWorkspace.classVal;
  } catch (err) { console.error('Failed to load class filter:', err); }
}

async function handleExamSelectChange(e) {
  currentExamWorkspace.examId = e.target.value || null;
  await Promise.all([populateSubjectSelect(true), renderExamSubjects()]);
}

function handleExamClassChange(e) {
  currentExamWorkspace.classVal = e.target.value || null;
  examSheetCache = [];
  renderExamSubjects();
}

async function addExamSubject() {
  const examId = currentExamWorkspace.examId;
  const classVal = currentExamWorkspace.classVal;
  const subject = getEl('subjectSelect').value;
  if (!examId) { alert('Please select an exam first.'); return; }
  if (!classVal) { alert('Please select a class from the class filter above first.'); return; }
  if (!subject) { alert('Please select a subject.'); return; }
  const { error } = await supabaseClient.from('exam_subjects').insert([{ exam_id: examId, class_name: classVal, subject }]);
  if (error) { alert(error.message); return; }
  showMessage('examMessage', `Subject added to exam for ${classVal}.`, 'success');
  await renderExamSubjects();
}

async function renderExamSubjects() {
  const examId = currentExamWorkspace.examId;
  const classVal = currentExamWorkspace.classVal;
  const tbody = getEl('examSubjectsBody');
  const noEl = getEl('noExamSubjects');
  if (!tbody) return;
  if (!examId) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
  try {
    let query = supabaseClient.from('exam_subjects').select('*').eq('exam_id', examId);
    if (classVal) query = query.eq('class_name', classVal);
    const { data } = await query.order('created_at', { ascending: true });
    const items = data || [];
    if (items.length === 0) { tbody.innerHTML = ''; if (noEl) noEl.style.display = 'block'; return; }
    if (noEl) noEl.style.display = 'none';
    tbody.innerHTML = items.map(it => `<tr><td><strong>${it.subject}</strong></td><td>${it.class_name ? `<span class="badge-confirmed">${it.class_name}</span>` : '<span class="badge-unconfirmed">All</span>'}</td><td><button class="action-btn danger" onclick="deleteExamSubject('${it.id}')">Remove</button></td></tr>`).join('');
  } catch (err) { console.error('Failed to render exam subjects:', err); }
}

window.deleteExamSubject = async function (id) {
  if (!confirm('Remove this subject from the exam?')) return;
  try {
    const { error } = await supabaseClient.from('exam_subjects').delete().eq('id', id);
    if (error) throw error;
    await renderExamSubjects();
  } catch (err) { alert('Error: ' + err.message); }
};

async function populateSubjectSelect(forceRefresh = false) {
  const sel = getEl('subjectSelect');
  if (!sel) return;
  try {
    const { getCurrentSchoolId } = await import('./utils.js');
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('subjects').select('name').order('name', { ascending: true });
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data, error } = await query;
    if (error) throw error;
    sel.innerHTML = '<option value="">— Select Subject —</option>' + (data || []).map(s => `<option>${s.name}</option>`).join('');
  } catch (err) { console.error('Failed to load subjects:', err); }
}

function loadScoreSheetTab() {
  const scoresheetBtn = document.querySelector('.exam-tab[data-etab="scoresheet"]');
  if (scoresheetBtn) scoresheetBtn.click();
  else loadScoreSheet();
}

// ================================================================
// Score Sheet
// ================================================================

export async function loadScoreSheet() {
  const examId = currentExamWorkspace.examId;
  const classVal = currentExamWorkspace.classVal;
  if (!examId) { alert('Please select an exam.'); return; }

  try {
    const schoolId = await getCurrentSchoolId();
    let query = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').eq('status', 'admitted');
    if (schoolId) query = query.eq('school_id', schoolId);
    if (classVal) query = query.eq('class_applying', classVal);
    const { data: apps } = await query.order('first_name', { ascending: true });
    if (!apps || apps.length === 0) { alert('No admitted students found for the selected class.'); return; }

    let subsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
    if (classVal) subsQuery = subsQuery.eq('class_name', classVal);
    const { data: examSubs } = await subsQuery;
    const subjects = (examSubs || []).map(s => s.subject);
    if (subjects.length === 0) { alert(classVal ? `No subjects added to this exam for ${classVal} yet.` : 'No subjects added to this exam yet.'); return; }

    const { data: results } = await supabaseClient.from('exam_results').select('*').eq('exam_id', examId);
    const resultMap = new Map((results || []).map(r => [`${r.student_id}|${r.subject}`, r]));

    const { data: studentDetails } = await supabaseClient.from('exam_student_details').select('*').eq('exam_id', examId);
    const detailsMap = new Map((studentDetails || []).map(d => [d.student_id, d]));

    const tbody = getEl('scoreSheetBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const table = getEl('scoreSheetTable');
    const thead = table.querySelector('thead');
    thead.innerHTML = '';
    examSheetCache = [];

    const scoreContainer = document.createElement('div');
    scoreContainer.className = 'score-card-container';
    scoreContainer.style.cssText = 'display:flex;flex-direction:column;gap:1.25rem;';

    apps.forEach(app => {
      const row = {
        student_id: app.student_id,
        name: buildStudentName(app.first_name, app.middle_name, app.last_name),
        class_applying: app.class_applying,
        scores: {},
        interest: detailsMap.get(app.student_id)?.interest || 'mathematics',
        attitude: detailsMap.get(app.student_id)?.attitude || 'active'
      };
      subjects.forEach(sub => {
        const key = `${app.student_id}|${sub}`;
        const existing = resultMap.get(key);
        row.scores[sub] = {
          classScore: existing?.class_score ?? '',
          examScoreInput: existing?.exam_score_input ?? (existing?.exam_score != null ? existing.exam_score * 2 : ''),
          examScore: existing?.exam_score ?? '',
          total: existing?.marks_obtained ?? ''
        };
      });
      examSheetCache.push(row);

      const card = document.createElement('div');
      card.className = 'score-student-card';
      card.style.cssText = 'background:var(--card-bg);border-radius:var(--radius);box-shadow:var(--shadow);border:1px solid var(--border);overflow:hidden;';

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;padding:0.75rem 1rem;background:var(--primary-light);border-bottom:1px solid var(--border);';
      header.innerHTML = `<strong style="font-size:0.9rem;color:var(--primary-dark);">${app.student_id}</strong><span style="font-weight:600;font-size:0.95rem;">${row.name}</span><span style="font-size:0.8rem;color:var(--text-muted);margin-left:auto;">${app.class_applying}</span><button type="button" class="btn btn-sm btn-clear score-save-btn" data-student="${app.student_id}" title="Save scores for this student" style="font-size:0.75rem;padding:0.2rem 0.5rem;background:rgba(22,163,74,0.1);color:#16a34a;border:1px solid rgba(22,163,74,0.3);border-radius:var(--radius-sm);cursor:pointer;">Save</button><button type="button" class="btn btn-sm btn-clear score-reset-btn" data-student="${app.student_id}" title="Reset all scores for this student" style="font-size:0.75rem;padding:0.2rem 0.5rem;background:rgba(220,38,38,0.1);color:#dc2626;border:1px solid rgba(220,38,38,0.3);border-radius:var(--radius-sm);cursor:pointer;">↺ Reset</button>`;
      card.appendChild(header);

      const body = document.createElement('div');
      body.style.cssText = 'padding:0.75rem 1rem;';

      subjects.forEach(sub => {
        const sc = row.scores[sub];
        const subRow = document.createElement('div');
        subRow.className = 'score-subject-row';
        subRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);';
        subRow.innerHTML = `
          <span class="score-subject-label" style="font-weight:600;font-size:0.85rem;min-width:100px;color:var(--text);">${sub}</span>
          <div class="score-input-group" style="display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem;flex:1;">
            <label style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:0.25rem;">CS(50)
              <input type="number" min="0" max="50" step="0.01" class="class-score" data-student="${app.student_id}" data-subject="${sub}" value="${sc.classScore}" placeholder="0-50" style="width:60px;padding:0.3rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.85rem;text-align:center;" />
            </label>
            <label style="font-size:0.75rem;color:var(--text-muted);display:flex;align-items:center;gap:0.25rem;">ES(100)
              <input type="number" min="0" max="100" step="0.01" class="exam-score-input" data-student="${app.student_id}" data-subject="${sub}" value="${sc.examScoreInput}" placeholder="0-100" style="width:65px;padding:0.3rem 0.4rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.85rem;text-align:center;" />
            </label>
            <span class="exam-score-calc score-badge-calc" style="font-size:0.75rem;background:#f0fdf4;color:#166534;padding:0.2rem 0.5rem;border-radius:6px;font-weight:600;">ES: ${sc.examScore || '0'}</span>
            <span class="total-calc score-badge-calc" style="font-size:0.75rem;background:#eff6ff;color:#1e40af;padding:0.2rem 0.5rem;border-radius:6px;font-weight:600;">T: ${sc.total || '0'}</span>
          </div>`;
        body.appendChild(subRow);
      });

      const metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.75rem;padding:0.5rem 0 0 0;margin-top:0.25rem;';
      metaRow.innerHTML = `
        <label style="font-size:0.8rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;">Interest
          <select class="student-interest" data-student="${app.student_id}" style="padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;">
            ${['mathematics','singing','writing','reading','athletics','science'].map(i => `<option value="${i}" ${row.interest === i ? 'selected' : ''}>${i.charAt(0).toUpperCase()+i.slice(1)}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:0.8rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;">Attitude
          <select class="student-attitude" data-student="${app.student_id}" style="padding:0.3rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;">
            ${['active','respectful','calm','obedient','pay attention','dull','truant','not active'].map(a => `<option value="${a}" ${row.attitude === a ? 'selected' : ''}>${a.charAt(0).toUpperCase()+a.slice(1)}</option>`).join('')}
          </select>
        </label>`;
      body.appendChild(metaRow);
      card.appendChild(body);
      scoreContainer.appendChild(card);
    });

    tbody.innerHTML = '';
    tbody.appendChild(scoreContainer);

    // --- Score Sheet Search ---
    const searchInput = getEl('scoreSheetSearch');
    const countEl = getEl('scoreSheetCount');
    if (countEl) countEl.textContent = `${apps.length} student(s) loaded`;

    if (searchInput) {
      // Remove old listener by cloning, then add fresh one
      const newSearch = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(newSearch, searchInput);
      const freshSearch = getEl('scoreSheetSearch');
      freshSearch.addEventListener('input', () => {
        const query = freshSearch.value.trim().toLowerCase();
        const cards = scoreContainer.querySelectorAll('.score-student-card');
        let visibleCount = 0;
        cards.forEach(card => {
          const headerText = card.querySelector('div:first-child')?.textContent?.toLowerCase() || '';
          const match = !query || headerText.includes(query);
          card.style.display = match ? '' : 'none';
          if (match) visibleCount++;
        });
        if (countEl) countEl.textContent = `${visibleCount} / ${cards.length} student(s) shown`;
      });
    }

    // Attach save button listeners
    tbody.querySelectorAll('.score-save-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const studentId = btn.dataset.student;
        saveStudentScores(studentId, btn);
      });
    });

    // Attach reset button listeners
    tbody.querySelectorAll('.score-reset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const studentId = btn.dataset.student;
        const row = examSheetCache.find(r => r.student_id === studentId);
        if (!row) return;
        if (!confirm(`Reset all scores for ${row.name} (${studentId})?`)) return;

        // Reset scores in cache
        Object.keys(row.scores).forEach(sub => {
          row.scores[sub] = { classScore: '', examScoreInput: '', examScore: '', total: '' };
        });
        row.interest = 'mathematics';
        row.attitude = 'active';

        // Reset all input fields in this card
        const card = btn.closest('.score-student-card');
        if (card) {
          card.querySelectorAll('.class-score').forEach(inp => { inp.value = ''; });
          card.querySelectorAll('.exam-score-input').forEach(inp => { inp.value = ''; });
          card.querySelectorAll('.exam-score-calc').forEach(el => { el.textContent = 'ES: 0'; });
          card.querySelectorAll('.total-calc').forEach(el => { el.textContent = 'T: 0'; });
          const interestSel = card.querySelector('.student-interest');
          if (interestSel) interestSel.value = 'mathematics';
          const attitudeSel = card.querySelector('.student-attitude');
          if (attitudeSel) attitudeSel.value = 'active';
        }
      });
    });

    // Attach input listeners
    tbody.querySelectorAll('.class-score, .exam-score-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const studentId = inp.dataset.student;
        const subject = inp.dataset.subject;
        const row = examSheetCache.find(r => r.student_id === studentId);
        if (!row) return;

        if (inp.classList.contains('class-score')) {
          const val = parseFloat(inp.value) || 0;
          const clamped = Math.min(val, 50);
          inp.value = clamped > 0 ? clamped : '';
          row.scores[subject].classScore = clamped > 0 ? clamped : '';
        } else if (inp.classList.contains('exam-score-input')) {
          const val = parseFloat(inp.value) || 0;
          const clamped = Math.min(val, 100);
          inp.value = clamped > 0 ? clamped : '';
          row.scores[subject].examScoreInput = clamped > 0 ? clamped : '';
          const examScoreCalc = clamped / 2;
          row.scores[subject].examScore = clamped > 0 ? examScoreCalc : '';
          const parentRow = inp.closest('.score-subject-row');
          if (parentRow) {
            const esSpan = parentRow.querySelector('.exam-score-calc');
            if (esSpan) esSpan.textContent = `ES: ${examScoreCalc.toFixed(2)}`;
          }
        }

        const cls = parseFloat(row.scores[subject].classScore) || 0;
        const esi = parseFloat(row.scores[subject].examScoreInput) || 0;
        const total = cls + (esi / 2);
        row.scores[subject].total = total > 0 ? Math.min(total, 100) : '';
        const parentRow = inp.closest('.score-subject-row');
        if (parentRow) {
          const totalSpan = parentRow.querySelector('.total-calc');
          if (totalSpan) totalSpan.textContent = `T: ${total.toFixed(2)}`;
        }
      });
    });

    tbody.querySelectorAll('.student-interest').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = examSheetCache.find(r => r.student_id === sel.dataset.student);
        if (row) row.interest = sel.value;
      });
    });
    tbody.querySelectorAll('.student-attitude').forEach(sel => {
      sel.addEventListener('change', () => {
        const row = examSheetCache.find(r => r.student_id === sel.dataset.student);
        if (row) row.attitude = sel.value;
      });
    });
  } catch (err) {
    console.error('Failed to load score sheet:', err);
    alert('Error loading score sheet: ' + err.message);
  }
}

// ================================================================
// Save Single Student Scores
// ================================================================

async function saveStudentScores(studentId, btn) {
  const examId = currentExamWorkspace.examId;
  if (!examId) { alert('Select an exam first.'); return; }

  const row = examSheetCache.find(r => r.student_id === studentId);
  if (!row) { alert('Student not found in score sheet.'); return; }

  const originalText = btn.innerHTML;
  setLoading(btn, true, 'Saving...');

  try {
    // Build upserts for this student's subject scores
    const upserts = [];
    Object.entries(row.scores).forEach(([sub, sc]) => {
      if (sc.classScore !== '' || sc.examScoreInput !== '') {
        const cls = sc.classScore === '' ? null : Math.min(parseFloat(sc.classScore), 50);
        const esi = sc.examScoreInput === '' ? null : Math.min(parseFloat(sc.examScoreInput), 100);
        const es = esi !== null ? esi / 2 : null;
        const total = (cls || 0) + (es || 0);
        upserts.push({
          exam_id: examId, student_id: row.student_id, subject: sub,
          class_score: cls, exam_score_input: esi, exam_score: es,
          marks_obtained: Math.min(total, 100),
        });
      }
    });

    if (upserts.length > 0) {
      const { error } = await supabaseClient.from('exam_results').upsert(upserts, { onConflict: 'exam_id,student_id,subject' });
      if (error) throw error;
    }

    // Calculate this student's average and save student details
    let totalMarks = 0, count = 0;
    Object.values(row.scores).forEach(sc => {
      if (sc.total !== '') { totalMarks += parseFloat(sc.total) || 0; count++; }
    });
    const average = count > 0 ? (totalMarks / count) : 0;
    const remarks = getTeacherRemarks(average);

    const { error: detailError } = await supabaseClient.from('exam_student_details').upsert({
      exam_id: examId, student_id: row.student_id,
      interest: row.interest || 'mathematics', attitude: row.attitude || 'active',
      class_teacher_remarks: remarks,
    }, { onConflict: 'exam_id,student_id' });
    if (detailError) throw detailError;

    showMessage('examMessage', `Saved scores for ${row.name} (${row.student_id}).`, 'success');
  } catch (err) {
    showMessage('examMessage', 'Error: ' + err.message, 'error');
    console.error('Save student scores error:', err);
  } finally {
    setLoading(btn, false, originalText);
  }
}

// ================================================================
// Save All Results
// ================================================================

async function saveAllResults() {
  const examId = currentExamWorkspace.examId;
  if (!examId) { alert('Select an exam first.'); return; }
  const btn = getEl('btnSaveAllResults');
  setLoading(btn, true, 'Saving...');
  try {
    const upserts = [];
    examSheetCache.forEach(row => {
      Object.entries(row.scores).forEach(([sub, sc]) => {
        if (sc.classScore !== '' || sc.examScoreInput !== '') {
          const cls = sc.classScore === '' ? null : Math.min(parseFloat(sc.classScore), 50);
          const esi = sc.examScoreInput === '' ? null : Math.min(parseFloat(sc.examScoreInput), 100);
          const es = esi !== null ? esi / 2 : null;
          const total = (cls || 0) + (es || 0);
          upserts.push({
            exam_id: examId, student_id: row.student_id, subject: sub,
            class_score: cls, exam_score_input: esi, exam_score: es,
            marks_obtained: Math.min(total, 100),
          });
        }
      });
    });

    if (upserts.length > 0) {
      const { error } = await supabaseClient.from('exam_results').upsert(upserts, { onConflict: 'exam_id,student_id,subject' });
      if (error) throw error;
    }

    // Calculate overall positions
    const classGroups = {};
    examSheetCache.forEach(row => {
      const cls = row.class_applying;
      if (!classGroups[cls]) classGroups[cls] = [];
      let totalMarks = 0, count = 0;
      Object.values(row.scores).forEach(sc => {
        if (sc.total !== '') { totalMarks += parseFloat(sc.total) || 0; count++; }
      });
      classGroups[cls].push({ student_id: row.student_id, totalMarks, count, interest: row.interest, attitude: row.attitude });
    });

    for (const [cls, students] of Object.entries(classGroups)) {
      students.sort((a, b) => b.totalMarks - a.totalMarks);
      for (let i = 0; i < students.length; i++) {
        const s = students[i];
        const position = i + 1;
        const average = s.count > 0 ? (s.totalMarks / s.count) : 0;
        const remarks = getTeacherRemarks(average);
        const { error: detailError } = await supabaseClient.from('exam_student_details').upsert({
          exam_id: examId, student_id: s.student_id,
          interest: s.interest || 'mathematics', attitude: s.attitude || 'active',
          class_teacher_remarks: remarks, overall_position: position,
        }, { onConflict: 'exam_id,student_id' });
        if (detailError) console.warn(`Failed to save details for ${s.student_id}:`, detailError);
      }
    }

    // Log success
    const totalStudents = Object.values(classGroups).reduce((sum, arr) => sum + arr.length, 0);
    showMessage('examMessage', `Saved scores for ${upserts.length} subjects across ${totalStudents} students with rankings.`, 'success');
  } catch (err) {
    showMessage('examMessage', 'Error: ' + err.message, 'error');
    console.error('Save results error:', err);
  } finally { setLoading(btn, false, 'Save All Scores'); }
}

// ================================================================
// Rankings
// ================================================================

export async function generateRankings() {
  const examId = currentExamWorkspace.examId;
  if (!examId) { alert('Select an exam first.'); return; }
  const container = getEl('rankingsContainer');
  if (!container) return;
  try {
    const classVal = currentExamWorkspace.classVal;
    let subsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
    if (classVal) subsQuery = subsQuery.eq('class_name', classVal);
    const { data: examSubs } = await subsQuery;
    const subjects = (examSubs || []).map(s => s.subject);
    if (subjects.length === 0) { container.innerHTML = '<p style="color:var(--text-muted)">No subjects for this exam.</p>'; return; }
    const schoolId = await getCurrentSchoolId();
    let appsQuery = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').eq('status', 'admitted');
    if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
    if (classVal) appsQuery = appsQuery.eq('class_applying', classVal);
    const { data: apps } = await appsQuery;
    if (!apps || apps.length === 0) { container.innerHTML = '<p style="color:var(--text-muted)">No students found.</p>'; return; }
    const appMap = new Map(apps.map(a => [a.student_id, a]));
    const { data: results } = await supabaseClient.from('exam_results').select('*').eq('exam_id', examId);
    container.innerHTML = '';

    const overallByClass = {};
    (results || []).forEach(r => {
      const app = appMap.get(r.student_id);
      const cls = app?.class_applying || 'Unknown';
      if (!overallByClass[cls]) overallByClass[cls] = {};
      if (!overallByClass[cls][r.student_id]) {
        const name = app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : r.student_id;
        overallByClass[cls][r.student_id] = { student_id: r.student_id, name, total: 0, count: 0 };
      }
      overallByClass[cls][r.student_id].total += (r.marks_obtained || 0);
      overallByClass[cls][r.student_id].count++;
    });

    const overallCard = document.createElement('div');
    overallCard.className = 'ranking-card';
    let overallHtml = `<div class="ranking-header"><strong>OVERALL RANKING</strong><span class="ranking-subtitle">By class (highest average)</span></div>`;
    Object.keys(overallByClass).sort().forEach(cls => {
      const students = Object.values(overallByClass[cls]).sort((a, b) => (b.total / b.count) - (a.total / a.count));
      overallHtml += `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:0.75rem;"><thead><tr><th style="border:1px solid #ccc;padding:0.4rem;text-align:left;">Pos</th><th style="border:1px solid #ccc;padding:0.4rem;text-align:left;">Student</th><th style="border:1px solid #ccc;padding:0.4rem;text-align:right;">Average</th><th style="border:1px solid #ccc;padding:0.4rem;text-align:center;">Grade</th></tr></thead><tbody>`;
      students.forEach((item, idx) => {
        const avg = item.count > 0 ? (item.total / item.count) : 0;
        const gradeInfo = getGrade(avg);
        let badge = '';
        if (idx === 0) badge = '<span class="rank-badge rank-1">1st</span>';
        else if (idx === 1) badge = '<span class="rank-badge rank-2">2nd</span>';
        else if (idx === 2) badge = '<span class="rank-badge rank-3">3rd</span>';
        else badge = `<span class="rank-badge rank-other">${idx+1}th</span>`;
        overallHtml += `<tr><td style="border:1px solid #ccc;padding:0.4rem;">${badge}</td><td style="border:1px solid #ccc;padding:0.4rem;">${item.name}</td><td style="border:1px solid #ccc;padding:0.4rem;text-align:right;">${avg.toFixed(1)}%</td><td style="border:1px solid #ccc;padding:0.4rem;text-align:center;font-weight:bold;">${gradeInfo.grade}</td></tr>`;
      });
      overallHtml += '</tbody></table>';
    });
    overallCard.innerHTML = overallHtml;
    container.appendChild(overallCard);

    subjects.forEach(sub => {
      const byClass = {};
      (results || []).filter(r => r.subject === sub).forEach(r => {
        const app = appMap.get(r.student_id);
        const cls = app?.class_applying || 'Unknown';
        if (!byClass[cls]) byClass[cls] = [];
        byClass[cls].push({ ...r, name: app ? buildStudentName(app.first_name, app.middle_name, app.last_name) : r.student_id });
      });
      const card = document.createElement('div');
      card.className = 'ranking-card';
      let html = `<div class="ranking-header"><strong>${sub}</strong><span class="ranking-subtitle">Rankings by class</span></div>`;
      Object.keys(byClass).sort().forEach(cls => {
        const list = byClass[cls].sort((a, b) => (b.marks_obtained || 0) - (a.marks_obtained || 0));
        html += `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-bottom:0.75rem;"><thead><tr><th style="border:1px solid #ccc;padding:0.4rem;text-align:left;">Rank</th><th style="border:1px solid #ccc;padding:0.4rem;text-align:left;">Student</th><th style="border:1px solid #ccc;padding:0.4rem;text-align:right;">Total</th></tr></thead><tbody>`;
        list.forEach((item, idx) => {
          const rank = idx + 1;
          let badge = '';
          if (rank === 1) badge = '<span class="rank-badge rank-1">1st</span>';
          else if (rank === 2) badge = '<span class="rank-badge rank-2">2nd</span>';
          else if (rank === 3) badge = '<span class="rank-badge rank-3">3rd</span>';
          else badge = `<span class="rank-badge rank-other">${rank}th</span>`;
          html += `<tr><td style="border:1px solid #ccc;padding:0.4rem;">${badge}</td><td style="border:1px solid #ccc;padding:0.4rem;">${item.name}</td><td style="border:1px solid #ccc;padding:0.4rem;text-align:right;">${(item.marks_obtained || 0).toFixed(2)}</td></tr>`;
        });
        html += '</tbody></table>';
      });
      card.innerHTML = html;
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to generate rankings:', err);
    container.innerHTML = '<p style="color:var(--text-muted)">Error generating rankings.</p>';
  }
}

// ================================================================
// CSV Export/Import
// ================================================================

function examCacheToCSV(examId, subjects) {
  const rows = [['Student ID', 'Student Name', 'Class', ...subjects.flatMap(s => [`${s} - Class(50)`, `${s} - Exam Input(100)`]), 'Interest', 'Attitude']];
  examSheetCache.forEach(row => {
    const scores = subjects.flatMap(sub => {
      const sc = row.scores[sub] || {};
      return [sc.classScore || '', sc.examScoreInput || ''];
    });
    rows.push([row.student_id, row.name, row.class_applying, ...scores, row.interest || '', row.attitude || '']);
  });
  return rows.map(r => r.map(cell => {
    const val = String(cell);
    return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val.replace(/"/g, '""')}"` : val;
  }).join(',')).join('\n');
}

async function exportCSV() {
  const examId = currentExamWorkspace.examId;
  const classVal = currentExamWorkspace.classVal;
  if (!examId) { alert('Please select an exam first.'); return; }
  if (examSheetCache.length === 0) await loadScoreSheet();
  if (examSheetCache.length === 0) { alert('No score data to export.'); return; }
  let subsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
  if (classVal) subsQuery = subsQuery.eq('class_name', classVal);
  const { data: examSubs } = await subsQuery;
  const subjects = (examSubs || []).map(s => s.subject);
  if (subjects.length === 0) { alert(classVal ? `No subjects configured for this exam for ${classVal}.` : 'No subjects configured for this exam.'); return; }
  const { data: exam } = await supabaseClient.from('exams').select('name').eq('id', examId).single();
  const csv = examCacheToCSV(examId, subjects);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const className = classVal ? classVal.replace(/\s+/g, '_') : 'all';
  link.download = `exam_scores_${exam?.name || 'exam'}_${className}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showMessage('examMessage', `Scores exported to CSV (${examSheetCache.length} students).`, 'success');
}

async function importCSV() {
  const file = this.files[0];
  if (!file) return;
  const examId = currentExamWorkspace.examId;
  if (!examId) { alert('Select an exam first.'); this.value = ''; return; }
  try {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) { alert('CSV file must have a header row and at least one data row.'); this.value = ''; return; }
    const header = parseCSVLine(lines[0]);
    const idIdx = header.findIndex(h => h.toLowerCase().includes('student id'));
    if (idIdx === -1) { alert('CSV must have a "Student ID" column.'); this.value = ''; return; }
    const subjectCols = [];
    for (let i = idIdx + 1; i < header.length; i++) {
      const col = header[i];
      if (col.toLowerCase().includes('interest') || col.toLowerCase().includes('attitude')) break;
      subjectCols.push(i);
    }
    const subPairs = [];
    for (let i = 0; i < subjectCols.length; i += 2) {
      if (i + 1 < subjectCols.length) {
        const subName = header[subjectCols[i]].split(' - ')[0]?.trim() || `Subject${subPairs.length + 1}`;
        subPairs.push({ subject: subName, classIdx: subjectCols[i], examInputIdx: subjectCols[i + 1] });
      }
    }
    const classVal = currentExamWorkspace.classVal;
    let subsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
    if (classVal) subsQuery = subsQuery.eq('class_name', classVal);
    const { data: examSubs } = await subsQuery;
    const dbSubjects = (examSubs || []).map(s => s.subject);
    await loadScoreSheet();
    let updated = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const studentId = vals[idIdx]?.trim();
      if (!studentId) continue;
      const cacheRow = examSheetCache.find(r => r.student_id === studentId);
      if (!cacheRow) continue;
      subPairs.forEach(sp => {
        const clsVal = vals[sp.classIdx]?.trim() || '';
        const esiVal = vals[sp.examInputIdx]?.trim() || '';
        const dbSub = dbSubjects.find(d => d.toLowerCase() === sp.subject.toLowerCase()) || sp.subject;
        if (clsVal) cacheRow.scores[dbSub] = { ...cacheRow.scores[dbSub], classScore: clsVal };
        if (esiVal) cacheRow.scores[dbSub] = { ...cacheRow.scores[dbSub], examScoreInput: esiVal };
      });
      const interestIdx = header.findIndex(h => h.toLowerCase().includes('interest'));
      const attitudeIdx = header.findIndex(h => h.toLowerCase().includes('attitude'));
      if (interestIdx >= 0 && vals[interestIdx]?.trim()) cacheRow.interest = vals[interestIdx].trim().toLowerCase();
      if (attitudeIdx >= 0 && vals[attitudeIdx]?.trim()) cacheRow.attitude = vals[attitudeIdx].trim().toLowerCase();
      updated++;
    }
    showMessage('examMessage', `Imported ${updated} student score(s) from CSV. Review and click "Save All Scores" to persist.`, 'success');
  } catch (err) {
    showMessage('examMessage', 'Error importing CSV: ' + err.message, 'error');
    console.error('Import CSV error:', err);
  }
  this.value = '';
}

// ================================================================
// REPORT CARDS — Complete Redesign (Print-Ready A4)
// ================================================================

export async function loadReportStudents() {
  const sel = getEl('reportStudent');
  if (!sel) return;
  const examId = currentExamWorkspace.examId;
  if (!examId) { sel.innerHTML = '<option value="">— Select Student —</option>'; return; }
  try {
    const classVal = currentExamWorkspace.classVal;
    const schoolId = await getCurrentSchoolId();
    let appsQuery = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').eq('status', 'admitted');
    if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
    const { data: apps } = await appsQuery;
    let filtered = apps || [];
    if (classVal) filtered = filtered.filter(a => a.class_applying === classVal);
    sel.innerHTML = '<option value="">— Select Student —</option>' + filtered.map(a => `<option value="${a.student_id}">${a.student_id} - ${buildStudentName(a.first_name, a.middle_name, a.last_name)} (${a.class_applying})</option>`).join('');
    
    // Populate the batch print class filter
    const classFilter = getEl('reportClassFilter');
    if (classFilter) {
      const classes = [...new Set((apps || []).map(a => a.class_applying).filter(Boolean))].sort();
      classFilter.innerHTML = '<option value="">— Select Class —</option>' + classes.map(c => `<option>${c}</option>`).join('');
      if (classVal) classFilter.value = classVal;
    }
  } catch (err) { console.error('Failed to load report students:', err); }
}

/**
 * Build a complete, print-ready report card HTML for a single student
 */
async function buildReportCardHTML(examId, studentId) {
  const { data: app } = await supabaseClient.from('applications').select('*').eq('student_id', studentId).maybeSingle();
  if (!app) return '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Student not found.</p>';

  const { data: exam } = await supabaseClient.from('exams').select('*').eq('id', examId).maybeSingle();
  if (!exam) return '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Exam not found.</p>';

  let subsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
  if (app.class_applying) subsQuery = subsQuery.eq('class_name', app.class_applying);
  const { data: examSubs } = await subsQuery;
  const subjects = (examSubs || []).map(s => s.subject);
  if (subjects.length === 0) return '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No subjects configured for this exam.</p>';

  const { data: results } = await supabaseClient.from('exam_results').select('*').eq('exam_id', examId).eq('student_id', studentId);
  const resultMap = new Map((results || []).map(r => [r.subject, r]));

  // Fetch student details (interest, attitude, position, remarks)
  const { data: studentDetails, error: detailsError } = await supabaseClient.from('exam_student_details').select('*').eq('exam_id', examId).eq('student_id', studentId).maybeSingle();
  if (detailsError) console.warn('Error fetching student details:', detailsError);
  console.log('ReportCard - studentDetails:', studentDetails, 'for student:', studentId, 'exam:', examId);
  
  const schoolId = await getCurrentSchoolId();
  let settings = null;
  let schoolName = '';
  let schoolLogoUrl = '';

  // PRIMARY: Fetch per-school settings from `school_settings` (the correct per-school table)
  if (schoolId) {
    const { data: schoolSettingsData } = await supabaseClient.from('school_settings')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (schoolSettingsData) {
      settings = schoolSettingsData;
      schoolName = schoolSettingsData.school_name || '';
      schoolLogoUrl = schoolSettingsData.logo_url || '';
    }
  }

  // FALLBACK: If no school_settings row, try the legacy `settings` table
  if (!settings) {
    let settingsQuery = supabaseClient.from('settings').select('*').eq('id', 'singleton');
    if (schoolId) settingsQuery = settingsQuery.eq('school_id', schoolId);
    const settingsResult = await settingsQuery.maybeSingle();
    settings = settingsResult.data || null;
    schoolName = settings?.school_name || '';
  }

  // FALLBACK: If still no school name, try the schools table
  if (!schoolName && schoolId) {
    const { data: schoolData } = await supabaseClient.from('schools')
      .select('name, logo_url')
      .eq('id', schoolId)
      .maybeSingle();
    if (schoolData?.name) schoolName = schoolData.name;
    if (!schoolLogoUrl && schoolData?.logo_url) schoolLogoUrl = schoolData.logo_url;
  }
  schoolName = schoolName || 'My School';
  const academicYear = exam.academic_year || settings?.academic_year || '';
  const term = exam.term || settings?.current_term || '';

  // Attendance — use the current settings academic year and term first (this is where
  // attendance records are actually stored, matching the Attendance tab), then fall back
  // to the exam's academic year and term.
  const yearForAtt = settings?.academic_year || exam.academic_year || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1);
  const termForAtt = settings?.current_term || exam.term || 'First';
  let { data: attRecords } = await supabaseClient.from('attendance').select('*').eq('student_id', studentId).eq('academic_year', yearForAtt).eq('term', termForAtt);
  if (!attRecords || attRecords.length === 0) {
    const fallbackYear = exam.academic_year;
    const fallbackTerm = exam.term;
    if (fallbackYear && (fallbackYear !== yearForAtt || fallbackTerm !== termForAtt)) {
      const { data: fallbackAtt } = await supabaseClient.from('attendance').select('*').eq('student_id', studentId).eq('academic_year', fallbackYear).eq('term', fallbackTerm);
      if (fallbackAtt && fallbackAtt.length > 0) attRecords = fallbackAtt;
    }
  }
  // If still no records, try fetching ALL attendance for this student (no year/term filter)
  // to handle cases where attendance was saved with different academic_year/term values
  if (!attRecords || attRecords.length === 0) {
    const { data: allAtt } = await supabaseClient.from('attendance').select('*').eq('student_id', studentId);
    if (allAtt && allAtt.length > 0) attRecords = allAtt;
  }
  const attStats = { present: 0, absent: 0 };
  (attRecords || []).forEach(r => { attStats[r.status]++; });
  const attTotal = (attRecords || []).length;
  const termDays = settings?.total_term_days ? parseInt(settings.total_term_days) : attTotal;
  const attPct = termDays > 0 ? ((attStats.present / termDays) * 100).toFixed(1) : 'N/A';

  // Calculate per-subject rankings for this student's class
  const subjectRanks = {};
  try {
    const { data: allResults } = await supabaseClient.from('exam_results').select('student_id, subject, marks_obtained')
      .eq('exam_id', examId);
    const { data: classApps } = await supabaseClient.from('applications')
      .select('student_id').eq('class_applying', app.class_applying);
    const classStudentIds = new Set((classApps || []).map(a => a.student_id));

    // Group results by subject, filter to this class, sort by marks, assign rank
    const bySubject = {};
    (allResults || []).forEach(r => {
      if (!classStudentIds.has(r.student_id)) return;
      if (!bySubject[r.subject]) bySubject[r.subject] = [];
      bySubject[r.subject].push({ student_id: r.student_id, marks: r.marks_obtained || 0 });
    });

    Object.keys(bySubject).forEach(sub => {
      bySubject[sub].sort((a, b) => b.marks - a.marks);
      const rank = bySubject[sub].findIndex(s => s.student_id === studentId) + 1;
      subjectRanks[sub] = rank > 0 ? rank : '-';
    });
  } catch (e) {
    console.warn('Could not calculate subject rankings:', e);
  }

  // Subject scores - use configurable grading per subject
  let total = 0, maxTotal = subjects.length * 100;
  const rowsPromises = subjects.map(async sub => {
    const r = resultMap.get(sub);
    const marks = r ? (r.marks_obtained || 0) : 0;
    total += marks;
    const classScore = r ? (r.class_score || 0) : 0;
    const examScore = r ? (r.exam_score || 0) : 0;
    // Use configurable per-subject grading
    const gradeInfo = await getGradeForScore(marks, sub);
    const perf = await getPerformanceLevel(marks);
    const position = subjectRanks[sub] || '-';
    const posBadge = position === 1 ? '<span class="rank-badge rank-1">1st</span>'
      : position === 2 ? '<span class="rank-badge rank-2">2nd</span>'
      : position === 3 ? '<span class="rank-badge rank-3">3rd</span>'
      : position !== '-' ? `<span class="rank-badge rank-other">${position}th</span>`
      : '<span class="rank-badge rank-other">-</span>';
    return `<tr>
      <td class="rc-subject-name">${sub}</td>
      <td class="rc-score">${classScore.toFixed(1)}</td>
      <td class="rc-score">${examScore.toFixed(1)}</td>
      <td class="rc-total">${marks.toFixed(1)}</td>
      <td class="rc-rank">${posBadge}</td>
      <td class="rc-grade-cell"><span class="rc-grade-badge ${gradeInfo.cls}">${gradeInfo.grade}</span></td>
      <td class="rc-remark"><span class="rc-perf-text ${perf.cls}">${perf.text}</span></td>
    </tr>`;
  });
  const rows = (await Promise.all(rowsPromises)).join('');

  const average = subjects.length ? (total / subjects.length) : 0;
  const name = buildStudentName(app.first_name, app.middle_name, app.last_name);
  const gradeInfo = getGrade(average);
  const gradingScaleHTML = await getGradingScaleHTML();
  const remarks = studentDetails?.class_teacher_remarks || getTeacherRemarks(average);
  const headTeacherRemarks = getHeadTeacherRemarks(average);
  
  // Get interest and attitude - try studentDetails first, then fallback to examSheetCache
  let interest = studentDetails?.interest || '';
  let attitude = studentDetails?.attitude || '';
  
  // If not in DB, try to get from examSheetCache (in-memory score sheet data)
  if (!interest || !attitude) {
    // Try loading score sheet data if cache is empty
    if (examSheetCache.length === 0) {
      try {
        const { data: details } = await supabaseClient.from('exam_student_details')
          .select('student_id, interest, attitude')
          .eq('exam_id', examId);
        if (details) {
          const found = details.find(d => d.student_id === studentId);
          if (found) {
            if (!interest) interest = found.interest || '';
            if (!attitude) attitude = found.attitude || '';
          }
        }
      } catch (e) { /* ignore */ }
    } else {
      const cacheRow = examSheetCache.find(r => r.student_id === studentId);
      if (cacheRow) {
        if (!interest) interest = cacheRow.interest || '';
        if (!attitude) attitude = cacheRow.attitude || '';
      }
    }
  }
  
  // Final fallback to defaults
  if (!interest) interest = 'mathematics';
  if (!attitude) attitude = 'active';
  
  // Calculate overall position as fallback if not saved in studentDetails
  let overallPosition = studentDetails?.overall_position;
  if (!overallPosition || overallPosition === 0) {
    try {
      // Get all results for this exam to calculate relative position
      const { data: allResults } = await supabaseClient.from('exam_results').select('student_id, marks_obtained')
        .eq('exam_id', examId);
      
      // Get applications to filter by class
      const { data: classApps } = await supabaseClient.from('applications')
        .select('student_id')
        .eq('class_applying', app.class_applying);
      const classStudentIds = new Set((classApps || []).map(a => a.student_id));
      
      // Calculate averages only for students in the same class
      const studentAverages = {};
      (allResults || []).forEach(r => {
        if (!classStudentIds.has(r.student_id)) return;
        if (!studentAverages[r.student_id]) studentAverages[r.student_id] = { total: 0, count: 0 };
        studentAverages[r.student_id].total += (r.marks_obtained || 0);
        studentAverages[r.student_id].count++;
      });
      
      const sortedStudents = Object.entries(studentAverages)
        .map(([sid, data]) => ({ student_id: sid, avg: data.count > 0 ? data.total / data.count : 0 }))
        .sort((a, b) => b.avg - a.avg);
      
      const idx = sortedStudents.findIndex(s => s.student_id === studentId);
      if (idx >= 0) overallPosition = idx + 1;
    } catch (e) {
      console.warn('Could not calculate fallback position:', e);
    }
  }
  
  if (!overallPosition || overallPosition === 0) overallPosition = '-';

  const interestDisplay = interest ? interest.charAt(0).toUpperCase() + interest.slice(1) : '-';
  const attitudeDisplay = attitude ? attitude.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '-';
  const closingDate = exam.closing_date ? formatDate(exam.closing_date) : '-';
  const reopeningDate = exam.reopening_date ? formatDate(exam.reopening_date) : '-';
  const photoHtml = app.student_photo_url
    ? `<img src="${app.student_photo_url}" class="rc-photo" alt="Student" />`
    : `<div class="rc-photo rc-photo-placeholder"></div>`;

  // Position display
  const posSuffix = overallPosition === 1 ? 'st' : overallPosition === 2 ? 'nd' : overallPosition === 3 ? 'rd' : 'th';
  const posDisplay = overallPosition !== '-' ? `${overallPosition}${posSuffix}` : '-';

  // Attendance percentage color
  const attColor = attTotal > 0
    ? (parseFloat(attPct) >= 80 ? '#16a34a' : parseFloat(attPct) >= 50 ? '#f59e0b' : '#dc2626')
    : '#64748b';

  // Attendance bar width
  const attBarWidth = attTotal > 0 ? parseFloat(attPct) : 0;

  const logoHtml = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="School Logo" class="rc-logo" style="width:56px;height:56px;object-fit:contain;border-radius:8px;background:#fff;padding:2px;border:1px solid #e2e8f0;" />`
    : `<div class="rc-seal"></div>`;

  return `
<div class="rc-container">
  <!-- Top Color Bar -->
  <div class="rc-top-bar"></div>

  <!-- School Header -->
  <div class="rc-header">
    ${logoHtml}
    <div class="rc-school-info">
      <h1 class="rc-school-name">${schoolName}</h1>
      <p class="rc-school-address">${settings?.school_address || 'Excellence in Education'}</p>
      <p class="rc-school-motto">${settings?.school_motto || 'Knowledge, Character, Service'}</p>
    </div>
    <div class="rc-header-badge">ACADEMIC REPORT</div>
  </div>

  <!-- Student Info Section -->
  <div class="rc-student-section">
    <div class="rc-student-photo">${photoHtml}</div>
    <div class="rc-student-data">
      <table class="rc-info-table">
        <tr><td class="rc-label">Student Name</td><td class="rc-colon">:</td><td class="rc-value">${name}</td></tr>
        <tr><td class="rc-label">Student ID</td><td class="rc-colon">:</td><td class="rc-value">${studentId}</td></tr>
        <tr><td class="rc-label">Class / Grade</td><td class="rc-colon">:</td><td class="rc-value">${app.class_applying}</td></tr>
        <tr><td class="rc-label">Academic Year</td><td class="rc-colon">:</td><td class="rc-value">${academicYear}</td></tr>
        <tr><td class="rc-label">Term</td><td class="rc-colon">:</td><td class="rc-value">${getTermDisplay(term)}</td></tr>
        <tr><td class="rc-label">Exam</td><td class="rc-colon">:</td><td class="rc-value">${exam.name}</td></tr>
        <tr><td class="rc-label">Position in Class</td><td class="rc-colon">:</td><td class="rc-value"><span class="rc-position-badge">${posDisplay}</span></td></tr>
      </table>
    </div>
    <div class="rc-student-meta">
      <table class="rc-info-table">
        <tr><td class="rc-label">Gender</td><td class="rc-colon">:</td><td class="rc-value">${app.gender || '-'}</td></tr>
        <tr><td class="rc-label">Date of Birth</td><td class="rc-colon">:</td><td class="rc-value">${app.date_of_birth ? formatDate(app.date_of_birth) : '-'}</td></tr>
        <tr><td class="rc-label">Interest</td><td class="rc-colon">:</td><td class="rc-value">${interestDisplay}</td></tr>
        <tr><td class="rc-label">Attitude</td><td class="rc-colon">:</td><td class="rc-value">${attitudeDisplay}</td></tr>
        <tr><td class="rc-label">Days in School</td><td class="rc-colon">:</td><td class="rc-value">${attTotal} day(s)</td></tr>
      </table>
    </div>
  </div>

  <!-- Attendance Bar -->
  <div class="rc-attendance-bar">
    <div class="rc-att-label">ATTENDANCE</div>
    <div class="rc-att-track">
      <div class="rc-att-fill" style="width:${attBarWidth}%;background:${attColor};"></div>
    </div>
    <div class="rc-att-pct" style="color:${attColor};">${attPct}%</div>
    <div class="rc-att-breakdown">
      <span class="rc-att-item present">✓ ${attStats.present}</span>
      <span class="rc-att-item absent">✗ ${attStats.absent}</span>
    </div>
  </div>

  <!-- Subjects Score Table -->
  <table class="rc-subjects-table">
    <thead>
      <tr>
        <th class="rc-th-subject">SUBJECT</th>
        <th class="rc-th-score">CLASS SCORE (50)</th>
        <th class="rc-th-score">EXAM SCORE (50)</th>
        <th class="rc-th-total">TOTAL (100)</th>
        <th class="rc-th-rank">RANK</th>
        <th class="rc-th-grade">GRADE</th>
        <th class="rc-th-remark">REMARK</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <!-- Performance Summary -->
  <div class="rc-summary">
    <div class="rc-summary-item rc-summary-total">
      <span class="rc-summary-label">Total Score</span>
      <span class="rc-summary-value">${total.toFixed(1)}</span>
      <span class="rc-summary-sub">out of ${maxTotal}</span>
    </div>
    <div class="rc-summary-item rc-summary-average">
      <span class="rc-summary-label">Average</span>
      <span class="rc-summary-value">${average.toFixed(1)}%</span>
      <span class="rc-summary-sub">${gradeInfo.desc}</span>
    </div>
    <div class="rc-summary-item rc-summary-grade">
      <span class="rc-summary-label">Grade</span>
      <span class="rc-summary-value">${gradeInfo.grade}</span>
      <span class="rc-summary-sub">${gradeInfo.desc}</span>
    </div>
    <div class="rc-summary-item rc-summary-subjects">
      <span class="rc-summary-label">Subjects</span>
      <span class="rc-summary-value">${subjects.length}</span>
      <span class="rc-summary-sub">offered</span>
    </div>
  </div>

  <!-- Key / Legend -->
  <div class="rc-key">
    <span class="rc-key-title">Grading Scale:</span>
    ${gradingScaleHTML}
  </div>

  <!-- Remarks -->
  <div class="rc-remarks">
    <div class="rc-remarks-box rc-remarks-teacher">
      <div class="rc-remarks-header">Class Teacher's Remarks</div>
      <div class="rc-remarks-text">${remarks}</div>
      <div class="rc-remarks-signature">
        <span class="rc-sign-line">_________________________</span>
        <span class="rc-sign-label">Signature & Date</span>
      </div>
    </div>
    <div class="rc-remarks-box rc-remarks-head">
      <div class="rc-remarks-header">Head Teacher's Remarks</div>
      <div class="rc-remarks-text">${headTeacherRemarks || '___________________________________________________________'}</div>
      <div class="rc-remarks-signature">
        <span class="rc-sign-line">_________________________</span>
        <span class="rc-sign-label">Signature & Date</span>
      </div>
    </div>
  </div>

  <!-- Signatures -->
  <div class="rc-signatures">
    <div class="rc-sig-item">
      <div class="rc-sig-line"></div>
      <div class="rc-sig-role">Class Teacher</div>
      <div class="rc-sig-name">${settings?.class_teacher_name || ''}</div>
    </div>
    <div class="rc-sig-item">
      <div class="rc-sig-line"></div>
      <div class="rc-sig-role">Head Teacher</div>
      <div class="rc-sig-name">${settings?.head_teacher_name || ''}</div>
    </div>
    <div class="rc-sig-item">
      <div class="rc-sig-line"></div>
      <div class="rc-sig-role">Parent / Guardian</div>
      <div class="rc-sig-name">${app.parent_name || ''}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="rc-footer">
    <div class="rc-footer-left">
      <span class="rc-footer-label">Closing Date:</span> ${closingDate}
    </div>
    <div class="rc-footer-center">
      <span class="rc-footer-label">Report Generated:</span> ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
    </div>
    <div class="rc-footer-right">
      <span class="rc-footer-label">Reopening Date:</span> ${reopeningDate}
    </div>
  </div>
</div>`;
}

async function previewReportCard() {
  const examId = currentExamWorkspace.examId;
  const studentId = getEl('reportStudent').value;
  if (!examId || !studentId) { alert('Select both exam and student.'); return; }
  const preview = getEl('reportPreview');
  if (!preview) return;
  preview.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);"><span class="spinner"></span> Loading report card...</div>';
  try {
    const html = await buildReportCardHTML(examId, studentId);
    preview.innerHTML = html;
  } catch (err) {
    console.error('Failed to preview report card:', err);
    preview.innerHTML = `<p style="color:var(--danger);text-align:center;padding:2rem;">Error: ${err.message}</p>`;
  }
}

function printReportCard() {
  const preview = getEl('reportPreview');
  if (!preview || !preview.innerHTML.trim() || preview.innerHTML.includes('spinner')) {
    alert('Please preview a report card first.');
    return;
  }
  const reportEl = preview.querySelector('.rc-container');
  if (!reportEl) { alert('No report card to print.'); return; }
  printSingleReportCard(reportEl.outerHTML);
}

function printSingleReportCard(htmlContent) {
  let styles = collectStyles();
  // Add print-specific overrides
  styles += `
    body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;padding:0;margin:0;background:#fff;font-size:12px;}
    @page{size:A4;margin:12mm 10mm;}
    @media print{
      body{padding:0;margin:0;background:#fff;}
      .rc-container{box-shadow:none;border:1px solid #ccc;padding:1.2rem;max-width:100%;page-break-inside:avoid;}
      .rc-top-bar{height:4px;}
      .rc-subjects-table thead th{background:#1e293b!important;color:#fff!important;}
      .rc-subjects-table tbody tr:nth-child(even){background:#f8faff;}
      .rc-summary-total{background:#2563eb!important;}
      .rc-summary-average{background:#7c3aed!important;}
      .rc-summary-grade{background:#f59e0b!important;}
      .rc-summary-subjects{background:#10b981!important;}
      .rc-remarks-teacher{background:#f0fdf4!important;}
      .rc-remarks-head{background:#eff6ff!important;}
      .rc-key{background:#f8fafc!important;}
      *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
    }`;
  const win = openPrintWindow(
    `<html><head><title>Report Card</title><style>${styles}</style></head><body>${htmlContent}</body></html>`,
    'Report Card', 900, 700
  );
  if (win) {
    win.focus();
    setTimeout(() => { win.print(); }, 600);
  }
}

// ================================================================
// BATCH PRINT — Print all students in selected class
// ================================================================

window.batchPrintReportCards = async function () {
  const examId = currentExamWorkspace.examId;
  if (!examId) { alert('Please select an exam first.'); return; }
  const classVal = currentExamWorkspace.classVal;
  if (!classVal) { alert('Please select a specific class for batch printing.'); return; }

  const btn = getEl('btnPrintReportCards');
  setLoading(btn, true, 'Preparing...');

  try {
    const schoolId = await getCurrentSchoolId();
    let appsQuery = supabaseClient.from('applications')
      .select('student_id, first_name, middle_name, last_name, class_applying')
      .eq('status', 'admitted')
      .eq('class_applying', classVal);
    if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
    appsQuery = appsQuery.order('first_name', { ascending: true });
    const { data: apps } = await appsQuery;

    if (!apps || apps.length === 0) {
      alert('No students found in this class.');
      setLoading(btn, false, 'Print Report Cards');
      return;
    }

    // Build all report cards
    const allCards = [];
    for (const app of apps) {
      try {
        const html = await buildReportCardHTML(examId, app.student_id);
        if (html && !html.includes('not found')) {
          allCards.push(html);
        }
      } catch (e) {
        console.warn(`Failed to build report for ${app.student_id}:`, e);
      }
    }

    if (allCards.length === 0) {
      alert('No report cards could be generated.');
      setLoading(btn, false, 'Print Report Cards');
      return;
    }

    // Open print window with all cards
    let styles = collectStyles();
    styles += `
      body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;padding:0;margin:0;background:#fff;font-size:12px;}
      @page{size:A4;margin:12mm 10mm;}
      @media print{
        body{padding:0;margin:0;background:#fff;}
        .rc-container{box-shadow:none;border:1px solid #ccc;padding:1.2rem;max-width:100%;page-break-after:always;}
        .rc-container:last-child{page-break-after:auto;}
        .rc-top-bar{height:4px;}
        .rc-subjects-table thead th{background:#1e293b!important;color:#fff!important;}
        .rc-subjects-table tbody tr:nth-child(even){background:#f8faff;}
        .rc-summary-total{background:#2563eb!important;}
        .rc-summary-average{background:#7c3aed!important;}
        .rc-summary-grade{background:#f59e0b!important;}
        .rc-summary-subjects{background:#10b981!important;}
        .rc-remarks-teacher{background:#f0fdf4!important;}
        .rc-remarks-head{background:#eff6ff!important;}
        .rc-key{background:#f8fafc!important;}
        *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
      }`;

    const win = openPrintWindow(
      `<html><head><title>Report Cards - ${classVal}</title><style>${styles}</style></head><body>${allCards.join('\n')}</body></html>`,
      'Report Cards', 900, 700
    );
    if (win) {
      win.focus();
      setTimeout(() => { win.print(); }, 800);
    }
  } catch (err) {
    console.error('Batch print error:', err);
    alert('Error: ' + err.message);
  } finally {
    setLoading(btn, false, 'Print Report Cards');
  }
};

// ================================================================
// OVERALL EXAM SCORES SHEET — table form filtered by class
// ================================================================

export async function loadOverallScores() {
  const examId = currentExamWorkspace.examId;
  const classVal = currentExamWorkspace.classVal;
  const msgEl = getEl('overallScoresMessage');
  const tbody = getEl('overallScoresBody');
  const thead = getEl('overallScoresHead');
  const noEl = getEl('noOverallScores');
  
  if (!examId) {
    if (msgEl) showMessage('overallScoresMessage', 'Please select an exam first.', 'error');
    if (tbody) tbody.innerHTML = '';
    if (thead) thead.innerHTML = '';
    return;
  }

  try {
    // Get exam subjects (filtered by class if selected)
    let subsQuery = supabaseClient.from('exam_subjects').select('subject').eq('exam_id', examId);
    if (classVal) subsQuery = subsQuery.eq('class_name', classVal);
    const { data: examSubs } = await subsQuery;
    const subjects = (examSubs || []).map(s => s.subject);
    if (subjects.length === 0) {
      if (noEl) noEl.style.display = 'block';
      if (msgEl) showMessage('overallScoresMessage', 'No subjects configured for this exam.', 'error');
      if (tbody) tbody.innerHTML = '';
      if (thead) thead.innerHTML = '';
      if (msgEl) setTimeout(() => { clearMessage('overallScoresMessage'); }, 3000);
      return;
    }

    // Get admitted students
    const schoolId = await getCurrentSchoolId();
    let appsQuery = supabaseClient.from('applications').select('student_id, first_name, middle_name, last_name, class_applying').eq('status', 'admitted');
    if (schoolId) appsQuery = appsQuery.eq('school_id', schoolId);
    if (classVal) appsQuery = appsQuery.eq('class_applying', classVal);
    const { data: apps } = await appsQuery;
    if (!apps || apps.length === 0) {
      if (noEl) noEl.style.display = 'block';
      if (msgEl) showMessage('overallScoresMessage', 'No admitted students found for the selected class.', 'error');
      if (tbody) tbody.innerHTML = '';
      if (thead) thead.innerHTML = '';
      if (msgEl) setTimeout(() => { clearMessage('overallScoresMessage'); }, 3000);
      return;
    }

    // Get exam results
    const { data: results } = await supabaseClient.from('exam_results').select('*').eq('exam_id', examId);
    const resultMap = new Map((results || []).map(r => [`${r.student_id}|${r.subject}`, r]));

    // Calculate total, average per student and sort by average descending within each class
    const studentsWithScores = apps.map(app => {
      let studentTotal = 0, subjectCount = 0;
      subjects.forEach(sub => {
        const key = `${app.student_id}|${sub}`;
        const r = resultMap.get(key);
        if (r && r.marks_obtained != null) {
          studentTotal += r.marks_obtained;
          subjectCount++;
        }
      });
      const avg = subjectCount > 0 ? (studentTotal / subjectCount) : 0;
      return { ...app, studentTotal, subjectCount, avg };
    });

    // Group by class and sort by avg descending within each class
    const byClass = {};
    studentsWithScores.forEach(s => {
      const cls = s.class_applying;
      if (!byClass[cls]) byClass[cls] = [];
      byClass[cls].push(s);
    });
    Object.keys(byClass).forEach(cls => {
      byClass[cls].sort((a, b) => b.avg - a.avg);
    });

    // Flatten back to ordered list: all students sorted by class then by avg descending
    const orderedStudents = [];
    Object.keys(byClass).sort().forEach(cls => {
      byClass[cls].forEach(s => {
        orderedStudents.push(s);
      });
    });

    // Build header
    const subjectHeaders = subjects.map(s => `<th>${s}<br><small>CS/ES/T</small></th>`).join('');
    thead.innerHTML = `<tr>
      <th>#</th>
      <th>Student ID</th>
      <th>Name</th>
      <th>Class</th>
      ${subjectHeaders}
      <th>Total</th>
      <th>Average</th>
      <th>Grade</th>
      <th>Position</th>
    </tr>`;

    // Build rows in position order
    let html = '';
    let globalIdx = 0;
    Object.keys(byClass).sort().forEach(cls => {
      byClass[cls].forEach((s, posIdx) => {
        globalIdx++;
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
        const pos = posIdx + 1;
        const gradeInfo = getGrade(s.avg);

        const cells = subjects.map(sub => {
          const key = `${s.student_id}|${sub}`;
          const r = resultMap.get(key);
          if (r) {
            const cs = r.class_score || 0;
            const es = r.exam_score || 0;
            const t = r.marks_obtained || 0;
            return `<td style="text-align:center;font-size:0.8rem;">
              <span style="color:var(--text-muted);">${cs.toFixed(1)}</span> /
              <span style="color:var(--text-muted);">${es.toFixed(1)}</span> /
              <strong>${t.toFixed(1)}</strong>
            </td>`;
          }
          return '<td style="text-align:center;color:var(--text-muted);font-size:0.8rem;">- / - / -</td>';
        });

        let badge = '';
        if (pos === 1) badge = '<span class="rank-badge rank-1">1st</span>';
        else if (pos === 2) badge = '<span class="rank-badge rank-2">2nd</span>';
        else if (pos === 3) badge = '<span class="rank-badge rank-3">3rd</span>';
        else badge = `<span class="rank-badge rank-other">${pos}th</span>`;

        html += `<tr>
          <td style="text-align:center;">${globalIdx}</td>
          <td>${s.student_id}</td>
          <td><strong>${name}</strong></td>
          <td>${s.class_applying}</td>
          ${cells.join('')}
          <td style="text-align:center;font-weight:600;">${s.studentTotal.toFixed(1)}</td>
          <td style="text-align:center;font-weight:600;">${s.avg.toFixed(1)}%</td>
          <td style="text-align:center;"><span class="rc-grade-badge ${gradeInfo.cls}">${gradeInfo.grade}</span></td>
          <td style="text-align:center;">${badge}</td>
        </tr>`;
      });
    });

    tbody.innerHTML = html;
    if (noEl) noEl.style.display = 'none';
    if (msgEl) clearMessage('overallScoresMessage');
  } catch (err) {
    console.error('Failed to load overall scores:', err);
    if (msgEl) showMessage('overallScoresMessage', 'Error: ' + err.message, 'error');
  }
}

// Setup Overall Scores event listeners
getEl('btnRefreshOverallScores')?.addEventListener('click', loadOverallScores);

getEl('btnPrintOverallScores')?.addEventListener('click', () => {
  const examName = getEl('examSelect')?.selectedOptions?.[0]?.text || 'Exam';
  const classVal = currentExamWorkspace.classVal || 'All Classes';
  let styles = collectStyles();
  styles += `
    body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;padding:0;margin:0;background:#fff;font-size:11px;}
    @page{size:A4 landscape;margin:8mm 6mm;}
    @media print{
      body{padding:0;margin:0;background:#fff;}
      .app-table{border-collapse:collapse;width:100%;}
      .app-table th{background:#1e293b!important;color:#fff!important;padding:0.4rem;text-align:center;font-size:0.75rem;border:1px solid #ccc;}
      .app-table td{padding:0.3rem;border:1px solid #ddd;font-size:0.75rem;}
      .app-table tr:nth-child(even){background:#f8faff;}
      .rank-badge{font-size:0.65rem;padding:0.1rem 0.3rem;}
      *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
    }`;
  const content = getEl('overallScoresTable')?.outerHTML || '';
  if (!content) { alert('No data to print. Please refresh the scores first.'); return; }
  const html = `<html><head><title>Overall Scores - ${examName}</title><style>${styles}</style></head><body>
    <h2 style="text-align:center;font-size:1.1rem;margin-bottom:0.5rem;">Overall Exam Scores Sheet</h2>
    <p style="text-align:center;font-size:0.85rem;color:#666;margin-bottom:1rem;">${examName} | Class: ${classVal}</p>
    ${content}</body></html>`;
  const win = openPrintWindow(html, 'Overall Scores', 1200, 800);
  if (win) {
    win.focus();
    setTimeout(() => { win.print(); }, 600);
  }
});
