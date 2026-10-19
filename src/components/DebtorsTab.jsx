import { useEffect, useMemo, useState } from 'react';
import { Users, Printer, Download, MessageSquare } from 'lucide-react';
import { useSchoolId } from '../hooks/useSchool';
import { useToast } from '../context/ToastContext';
import { Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput } from './ui';
import { Alert } from './ui-extras';
import { supabase } from '../lib/supabase';
import { sendPlainSms, normalizeGhanaPhone } from '../lib/api';
import { buildStudentName, cedi, termLabel } from '../lib/format';
import { openPrintWindow, escapeHtml } from '../lib/print';
import { TERMS } from '../lib/constants';
import { feeBalance } from '../lib/feeMath';

const TERM_ORDER = { First: 0, Second: 1, Third: 2 };

export default function DebtorsTab() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]); // grouped debtors
  const [classes, setClasses] = useState([]);
  const [classFilter, setClassFilter] = useState('');
  const [termFilter, setTermFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({});
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMessage, setSmsMessage] = useState('');
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [schoolName, setSchoolName] = useState('School');
  const [schoolPhone, setSchoolPhone] = useState('');

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: feesData }, { data: appsData }, { data: classRows }, { data: schoolData }] = await Promise.all([
        supabase.from('fees').select('*').eq('school_id', schoolId),
        supabase
          .from('applications')
          .select('student_id, first_name, middle_name, last_name, class_applying, parent_contact')
          .eq('school_id', schoolId),
        supabase.from('classes').select('id, name').eq('school_id', schoolId).order('name'),
        supabase.from('schools').select('name, phone, sms_enabled').eq('id', schoolId).maybeSingle(),
      ]);
      setClasses(classRows || []);
      setSmsEnabled(schoolData?.sms_enabled !== false);
      setSchoolName(schoolData?.name || 'School');
      setSchoolPhone(schoolData?.phone || '');

      const nameMap = Object.fromEntries((appsData || []).map((a) => [a.student_id, a]));
      const groups = {};
      (feesData || []).forEach((f) => {
        const bal = feeBalance(f);
        if (bal > 0) {
          if (!groups[f.student_id]) {
            const app = nameMap[f.student_id] || {};
            groups[f.student_id] = { studentId: f.student_id, app, fees: [], total: 0 };
          }
          groups[f.student_id].fees.push(f);
          groups[f.student_id].total += bal;
        }
      });
      const list = Object.values(groups).map((g) => {
        g.fees.sort((a, b) => TERM_ORDER[a.term] - TERM_ORDER[b.term]);
        return g;
      });
      list.sort((a, b) => (a.app.last_name || '').localeCompare(b.app.last_name || ''));
      setRows(list);
    } catch (err) {
      toast.error('Could not load debtors', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (classFilter && r.app.class_applying !== classFilter) return false;
      if (termFilter && !r.fees.some((f) => f.term === termFilter)) return false;
      if (q) {
        const name = buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name).toLowerCase();
        if (!name.includes(q) && !r.studentId.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, classFilter, termFilter, search]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, r) => s + r.total, 0), [filtered]);

  const selectedCount = Object.values(selected).filter(Boolean).length;

  const toggleSelect = (studentId) => setSelected((s) => ({ ...s, [studentId]: !s[studentId] }));

  const selectAll = () => {
    const allSelected = filtered.every((r) => selected[r.studentId]);
    setSelected((s) => {
      const next = { ...s };
      filtered.forEach((r) => {
        next[r.studentId] = !allSelected;
      });
      return next;
    });
  };

  const buildReminderSms = (r) => {
    const name = buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name);
    const contact = schoolPhone ? ` For enquiries, call ${schoolPhone}.` : '';
    return `Dear Parent/Guardian, kindly note that ${name} (${r.studentId}, Class ${r.app.class_applying}) has an outstanding fee balance of GHC ${r.total.toFixed(2)} at ${schoolName}. Please clear it at the accounts office. Thank you.${contact}`;
  };

  const sendSmsReminders = async () => {
    setSmsMessage('');
    const rowsSelected = filtered.filter((r) => selected[r.studentId]);
    if (!rowsSelected.length) {
      setSmsMessage('Select at least one debtor to send reminders to.');
      return;
    }
    if (!smsEnabled) {
      setSmsMessage('SMS is disabled for this school by the Super Admin.');
      toast.error('SMS disabled', 'Fee reminder messages cannot be sent.');
      return;
    }
    setSmsBusy(true);
    let sent = 0;
    let failed = 0;
    let noPhone = 0;
    try {
      for (let i = 0; i < rowsSelected.length; i++) {
        const r = rowsSelected[i];
        const phone = normalizeGhanaPhone(r.app.parent_contact);
        if (!phone) {
          noPhone += 1;
          continue;
        }
        const res = await sendPlainSms({
          schoolId,
          studentId: r.studentId,
          phone,
          message: buildReminderSms(r),
        });
        if (res.ok) sent += 1;
        else failed += 1;
      }
      setSmsMessage(`Bulk SMS complete: ${sent} sent · ${failed} failed${noPhone ? ` · ${noPhone} skipped (no valid phone)` : ''}.`);
      toast[sent > 0 ? 'success' : 'error'](sent > 0 ? 'Reminders sent' : 'No messages sent', `${sent} sent · ${failed} failed${noPhone ? ` · ${noPhone} skipped` : ''}.`);
    } catch (err) {
      toast.error('Bulk SMS error', err.message);
    } finally {
      setSmsBusy(false);
      setSelected({});
    }
  };

  const printDebtors = () => {
    // Per-column filter choices offered in the print window are derived from
    // the rows actually being printed.
    const classOptions = [...new Set(filtered.map((r) => r.app.class_applying).filter(Boolean))]
      .sort()
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join('');
    const termOptions = [...new Set(filtered.flatMap((r) => r.fees.map((f) => `${f.term} ${f.academic_year}`)))]
      .sort()
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join('');

    const rowsHtml = filtered
      .map((r) => {
        const name = buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name);
        const termKeys = r.fees.map((f) => `${f.term} ${f.academic_year}`);
        const terms = r.fees
          .map((f) => `${f.term} ${f.academic_year}: ${cedi(Math.max(feeBalance(f), 0))}`)
          .join('<br/>');
        return `<tr data-id="${escapeHtml(String(r.studentId).toLowerCase())}" data-name="${escapeHtml(name.toLowerCase())}" data-class="${escapeHtml(r.app.class_applying || '')}" data-phone="${escapeHtml(r.app.parent_contact || '')}" data-terms="${escapeHtml(termKeys.join('|'))}" data-total="${Number(r.total) || 0}">
          <td>${escapeHtml(r.studentId)}</td>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(r.app.class_applying || '-')}</td>
          <td>${escapeHtml(r.app.parent_contact || '-')}</td>
          <td>${terms}</td>
          <td class="right"><b>${cedi(r.total)}</b></td>
        </tr>`;
      })
      .join('');

    openPrintWindow('Debtors list', `
      <style>
        .filter-row th { background: #eef2ff; padding: 4px 5px; }
        .filter-row input, .filter-row select { width: 100%; box-sizing: border-box; font-size: 11px; padding: 3px 5px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #0f172a; }
        .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 8px; font-size: 12px; color: #444; }
        .controls button { padding: 6px 14px; font-size: 12px; }
        .empty-row td { text-align: center; color: #777; }
        @media print { .controls, .filter-row { display: none; } }
      </style>
      <h1>${escapeHtml(schoolName)} — Debtors List</h1>
      <p>${escapeHtml(classFilter ? `Class: ${classFilter}` : 'All classes')}${termFilter ? ` · Term: ${termFilter}` : ''} · <span id="dCount">${filtered.length}</span> debtor(s)</p>
      <div class="controls">
        <span>Type or pick a value under any column heading to narrow the list, then print — the filters are hidden on paper.</span>
        <button type="button" id="dReset">Reset filters</button>
      </div>
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Class</th><th>Parent phone</th><th>Outstanding terms</th><th class="right">Total</th></tr>
          <tr class="filter-row">
            <th><input id="fId" type="text" placeholder="All IDs" aria-label="Filter by student ID" /></th>
            <th><input id="fName" type="text" placeholder="All names" aria-label="Filter by student name" /></th>
            <th><select id="fClass" aria-label="Filter by class"><option value="">All classes</option>${classOptions}</select></th>
            <th><input id="fPhone" type="text" placeholder="All phones" aria-label="Filter by parent phone" /></th>
            <th><select id="fTerm" aria-label="Filter by outstanding term"><option value="">All terms</option>${termOptions}</select></th>
            <th class="right"><span style="display:flex;gap:4px;justify-content:flex-end;"><input id="fMin" type="number" min="0" step="any" placeholder="Min" aria-label="Minimum total" style="width:64px;" /><input id="fMax" type="number" min="0" step="any" placeholder="Max" aria-label="Maximum total" style="width:64px;" /></span></th>
          </tr>
        </thead>
        <tbody id="dBody">
          ${rowsHtml}
          <tr id="dEmpty" class="empty-row" style="display:none;"><td colspan="6">No debtors match the current filters.</td></tr>
        </tbody>
        <tr class="total-row"><td colspan="5">Total outstanding</td><td class="right"><b id="dSum">${cedi(totalOutstanding)}</b></td></tr>
      </table>
      <script>
      (function () {
        var tbody = document.getElementById('dBody');
        if (!tbody) return;
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-total]'));
        var f = ['fId', 'fName', 'fClass', 'fPhone', 'fTerm', 'fMin', 'fMax'].map(function (id) { return document.getElementById(id); });
        if (f.some(function (el) { return !el; })) return;
        var countEl = document.getElementById('dCount');
        var sumEl = document.getElementById('dSum');
        var emptyEl = document.getElementById('dEmpty');
        var digits = function (s) { return String(s || '').replace(/\D/g, ''); };

        function apply() {
          var idq = f[0].value.trim().toLowerCase();
          var nameq = f[1].value.trim().toLowerCase();
          var clsq = f[2].value;
          var phoneq = digits(f[3].value);
          var termq = f[4].value;
          var minv = f[5].value === '' ? null : Number(f[5].value);
          var maxv = f[6].value === '' ? null : Number(f[6].value);
          var shown = 0, sum = 0;
          rows.forEach(function (tr) {
            var total = Number(tr.getAttribute('data-total')) || 0;
            var ok = true;
            if (idq && String(tr.getAttribute('data-id') || '').indexOf(idq) === -1) ok = false;
            if (ok && nameq && String(tr.getAttribute('data-name') || '').indexOf(nameq) === -1) ok = false;
            if (ok && clsq && String(tr.getAttribute('data-class') || '') !== clsq) ok = false;
            if (ok && phoneq && digits(tr.getAttribute('data-phone')).indexOf(phoneq) === -1) ok = false;
            if (ok && termq && String(tr.getAttribute('data-terms') || '').split('|').indexOf(termq) === -1) ok = false;
            if (ok && minv !== null && !isNaN(minv) && total < minv) ok = false;
            if (ok && maxv !== null && !isNaN(maxv) && total > maxv) ok = false;
            tr.style.display = ok ? '' : 'none';
            if (ok) { shown += 1; sum += total; }
          });
          if (countEl) countEl.textContent = shown + ' debtor(s)';
          if (sumEl) sumEl.textContent = 'GHC ' + sum.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (emptyEl) emptyEl.style.display = shown ? 'none' : '';
        }

        f.forEach(function (el) {
          el.addEventListener('input', apply);
          el.addEventListener('change', apply);
        });
        var reset = document.getElementById('dReset');
        if (reset) reset.addEventListener('click', function () {
          f.forEach(function (el) { el.value = ''; });
          apply();
        });
        apply();
      })();
      </script>
    `);
  };

  const exportCsv = () => {
    if (!filtered.length) return;
    const lines = [['Student ID', 'Name', 'Class', 'Parent Phone', 'Total Balance (GHC)']];
    filtered.forEach((r) => {
      lines.push([r.studentId, buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name), r.app.class_applying || '', r.app.parent_contact || '', r.total.toFixed(2)]);
    });
    const blob = new Blob([lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debtors_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="w-full sm:col-span-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search debtor name or ID..." />
          </div>
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
            <option value="">All terms</option>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">
            <b className="text-rose-600">{filtered.length}</b> debtor(s) · Outstanding <b className="text-rose-600">{cedi(totalOutstanding)}</b>
          </span>
          <Button variant="secondary" onClick={printDebtors} disabled={!filtered.length}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-4 w-4" aria-hidden="true" />
            CSV
          </Button>
          <Button onClick={sendSmsReminders} loading={smsBusy} disabled={!selectedCount}>
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Send reminder SMS ({selectedCount})
          </Button>
        </div>
      </div>

      {!smsEnabled ? (
        <Alert tone="warning" className="mb-4">
          SMS is disabled for this school by the Super Admin — fee reminder messages cannot be sent.
        </Alert>
      ) : null}
      {smsMessage ? (
        <Alert tone="info" className="mb-4">
          {smsMessage}
        </Alert>
      ) : null}

      {loading ? (
        <Spinner label="Loading debtors..." />
      ) : filtered.length ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-sm text-slate-500">
            <input type="checkbox" checked={filtered.length > 0 && filtered.every((r) => selected[r.studentId])} onChange={selectAll} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
            <span>Select all ({filtered.length})</span>
          </div>
          {filtered.map((r) => {
            const name = buildStudentName(r.app.first_name, r.app.middle_name, r.app.last_name);
            const hasPhone = !!normalizeGhanaPhone(r.app.parent_contact);
            return (
              <Card key={r.studentId} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <input type="checkbox" checked={!!selected[r.studentId]} onChange={() => toggleSelect(r.studentId)} className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">{name}</p>
                      <p className="font-mono text-xs text-slate-400">
                        {r.studentId} · {r.app.class_applying || '—'} · {hasPhone ? r.app.parent_contact : 'No phone'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {r.fees.map((f) => {
                        const bal = feeBalance(f);
                        return (
                          <Badge key={f.id} tone="red">
                            {f.term} {f.academic_year}: {cedi(Math.max(bal, 0))}
                          </Badge>
                        );
                      })}
                    </div>
                    <b className="shrink-0 text-sm text-rose-600">{cedi(r.total)}</b>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Users} title="No debtors" message="All fee balances are up to date. Students appear here when a fee record has an outstanding balance." />
      )}
    </div>
  );
}