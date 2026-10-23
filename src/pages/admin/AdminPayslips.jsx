import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreditCard, UserRound, Users, Plus, Pencil, Printer, Download,
  RefreshCw, Trash2, FileText, Calendar, Wallet, Eye,
} from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader, Card, Button, Input, Select, Spinner, EmptyState,
  Badge, SearchInput,
} from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { logActivityForCurrentUser } from '../../lib/activity';
import { buildCSV, downloadCSV } from '../../lib/csv';
import { cedi, formatDate } from '../../lib/format';
import { openPrintWindow, escapeHtml } from '../../lib/print';
import {
  currentAcademicYear, academicYearList, TERMS, TERM_LABELS,
} from '../../lib/constants';

const esc = escapeHtml;

const MONTHS = [
  { value: 1, label: 'January' }, { value: 2, label: 'February' },
  { value: 3, label: 'March' }, { value: 4, label: 'April' },
  { value: 5, label: 'May' }, { value: 6, label: 'June' },
  { value: 7, label: 'July' }, { value: 8, label: 'August' },
  { value: 9, label: 'September' }, { value: 10, label: 'October' },
  { value: 11, label: 'November' }, { value: 12, label: 'December' },
];

function emptyPayslipForm() {
  const now = new Date();
  return {
    staff_id: '',
    staff_type: 'teacher',
    staff_name: '',
    staff_registration_id: '',
    pay_month: String(now.getMonth() + 1),
    pay_year: String(now.getFullYear()),
    academic_year: currentAcademicYear(),
    term: 'Third',
    basic_salary: '',
    allowance_housing: '',
    allowance_transport: '',
    allowance_other: '',
    deduction_tax: '',
    deduction_ssnit: '',
    deduction_loan: '',
    deduction_other: '',
    net_pay: '',
    notes: '',
  };
}

function money(v) {
  return Number(v || 0);
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdminPayslips() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [staff, setStaff] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [yearFilter, setYearFilter] = useState(String(new Date().getFullYear()));

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyPayslipForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [viewing, setViewing] = useState(null);
  const [printingAll, setPrintingAll] = useState(false);

  const nowYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const years = [];
    for (let y = nowYear - 5; y <= nowYear + 5; y += 1) years.push(String(y));
    return years;
  }, [nowYear]);

  const load = useCallback(() => {
    if (!schoolId) return;
    setLoading(true);
    Promise.all([
      supabase.from('teachers').select('id, full_name, registration_id, photo_url, email, phone, staff_type').eq('school_id', schoolId),
      supabase.from('accountants').select('id, full_name, registration_id, photo_url, email, phone').eq('school_id', schoolId),
      supabase.from('staff_payslips').select('*').eq('school_id', schoolId).order('pay_year', { ascending: false }).order('pay_month', { ascending: false }),
    ]).then(([tRes, aRes, pRes]) => {
      if (tRes.error) toast.error('Could not load teachers', tRes.error.message);
      else if (aRes.error) toast.error('Could not load accountants', aRes.error.message);
      else if (pRes.error) toast.error('Could not load payslips', pRes.error.message);
      else {
        const teachers = (tRes.data || []).map((t) => ({
          id: t.id, staff_type: 'teacher', full_name: t.full_name,
          registration_id: t.registration_id, photo_url: t.photo_url,
          email: t.email, phone: t.phone,
        }));
        const accountants = (aRes.data || []).map((a) => ({
          id: a.id, staff_type: 'accountant', full_name: a.full_name,
          registration_id: a.registration_id, photo_url: a.photo_url,
          email: a.email, phone: a.phone,
        }));
        setStaff([...teachers, ...accountants]);
        setPayslips(pRes.data || []);
      }
      setLoading(false);
    });
  }, [schoolId, toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const staffById = useMemo(() => {
    const m = {};
    staff.forEach((s) => { m[s.id] = s; });
    return m;
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      const hay = `${s.full_name} ${s.registration_id || ''} ${s.email || ''} ${s.phone || ''}`.toLowerCase();
      return !q || hay.includes(q);
    });
  }, [staff, query]);

  const periodPayslips = useMemo(() => {
    const m = monthFilter ? Number(monthFilter) : null;
    const y = yearFilter ? Number(yearFilter) : null;
    return payslips.filter((p) => (!m || p.pay_month === m) && (!y || p.pay_year === y));
  }, [payslips, monthFilter, yearFilter]);

  const latestPayslipFor = (s) => {
    let best = null;
    payslips.forEach((p) => {
      if (p.staff_id === s.id && p.staff_type === s.staff_type) {
        if (!best || p.pay_year > best.pay_year || (p.pay_year === best.pay_year && p.pay_month > best.pay_month)) {
          best = p;
        }
      }
    });
    return best;
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const computeNet = () => {
    const basic = money(form.basic_salary);
    const housing = money(form.allowance_housing);
    const transport = money(form.allowance_transport);
    const other = money(form.allowance_other);
    const tax = money(form.deduction_tax);
    const ssnit = money(form.deduction_ssnit);
    const loan = money(form.deduction_loan);
    const otherD = money(form.deduction_other);
    const gross = basic + housing + transport + other;
    const deductions = tax + ssnit + loan + otherD;
    const net = gross - deductions;
    return { gross, deductions, net: net < 0 ? 0 : net };
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyPayslipForm());
    setError('');
    setOpen(true);
  };

  const openEdit = (payslip) => {
    const s = staffById[payslip.staff_id];
    setEditing(payslip);
    setForm({
      staff_id: payslip.staff_id,
      staff_type: payslip.staff_type,
      staff_name: s ? s.full_name : payslip.staff_name,
      staff_registration_id: s ? (s.registration_id || '') : (payslip.staff_registration_id || ''),
      pay_month: String(payslip.pay_month),
      pay_year: String(payslip.pay_year),
      academic_year: payslip.academic_year || '',
      term: payslip.term || 'Third',
      basic_salary: String(payslip.basic_salary),
      allowance_housing: String(payslip.allowance_housing),
      allowance_transport: String(payslip.allowance_transport),
      allowance_other: String(payslip.allowance_other),
      deduction_tax: String(payslip.deduction_tax),
      deduction_ssnit: String(payslip.deduction_ssnit),
      deduction_loan: String(payslip.deduction_loan),
      deduction_other: String(payslip.deduction_other),
      net_pay: String(payslip.net_pay),
      notes: payslip.notes || '',
    });
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.staff_id) {
      setError('Please select a staff member.');
      return;
    }
    const { net } = computeNet();
    setBusy(true);
    try {
      const payload = {
        school_id: schoolId,
        staff_id: form.staff_id,
        staff_type: form.staff_type,
        staff_name: form.staff_name.trim(),
        staff_registration_id: form.staff_registration_id.trim() || null,
        pay_month: Number(form.pay_month),
        pay_year: Number(form.pay_year),
        academic_year: form.academic_year.trim() || null,
        term: form.term || 'Third',
        basic_salary: money(form.basic_salary),
        allowance_housing: money(form.allowance_housing),
        allowance_transport: money(form.allowance_transport),
        allowance_other: money(form.allowance_other),
        deduction_tax: money(form.deduction_tax),
        deduction_ssnit: money(form.deduction_ssnit),
        deduction_loan: money(form.deduction_loan),
        deduction_other: money(form.deduction_other),
        net_pay: net,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { error: uErr } = await supabase
          .from('staff_payslips')
          .update(payload)
          .eq('id', editing.id);
        if (uErr) throw new Error(uErr.message);
        await logActivityForCurrentUser(`Updated payslip for ${form.staff_name} (${form.pay_month}/${form.pay_year})`, {
          entityType: 'payslip',
          entityDetails: `Net pay: ${cedi(net)}`,
        });
        toast.success('Payslip updated');
      } else {
        const { error: iErr } = await supabase
          .from('staff_payslips')
          .insert(payload);
        if (iErr) throw new Error(iErr.message);
        await logActivityForCurrentUser(`Generated payslip for ${form.staff_name} (${form.pay_month}/${form.pay_year})`, {
          entityType: 'payslip',
          entityDetails: `Net pay: ${cedi(net)}`,
        });
        toast.success('Payslip generated');
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message || 'Could not save payslip.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setDeleteBusy(true);
    try {
      const { error: dErr } = await supabase
        .from('staff_payslips')
        .delete()
        .eq('id', deleting.id);
      if (dErr) throw new Error(dErr.message);
      await logActivityForCurrentUser(`Deleted payslip for ${deleting.staff_name} (${deleting.pay_month}/${deleting.pay_year})`, {
        entityType: 'payslip',
      });
      toast.success('Payslip deleted');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete payslip', err.message);
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const printPayslip = (p) => {
    const s = staffById[p.staff_id];
    const b = money(p.basic_salary);
    const h = money(p.allowance_housing);
    const t = money(p.allowance_transport);
    const o = money(p.allowance_other);
    const tx = money(p.deduction_tax);
    const ss = money(p.deduction_ssnit);
    const ln = money(p.deduction_loan);
    const od = money(p.deduction_other);
    const gross = b + h + t + o;
    const deductions = tx + ss + ln + od;
    const net = money(p.net_pay);
    const schoolName = (window.__schoolName || 'School');
    const monthLabel = MONTHS.find((m) => m.value === p.pay_month)?.label || String(p.pay_month);
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Payslip - ${esc(p.staff_name)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 24px; }
  .header { text-align: center; border-bottom: 3px double #111; padding-bottom: 12px; margin-bottom: 20px; }
  .school { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
  .doc-title { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #666; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; text-align: left; }
  th { background: #f1f5f9; font-weight: 700; width: 34%; }
  .right { text-align: right; }
  .total-row td { font-weight: 700; background: #f8fafc; border-top: 2px solid #333; }
  .net-row td { font-weight: 800; font-size: 14px; background: #eef2ff; border-top: 2px solid #2563eb; color: #1e3a8a; }
  .meta { display: flex; gap: 24px; font-size: 12px; color: #444; margin-bottom: 16px; }
  .meta div { flex: 1; }
  .sig { margin-top: 34px; display: flex; gap: 40px; font-size: 11px; color: #444; }
  .sig div { border-top: 1px solid #999; padding-top: 6px; text-align: center; width: 180px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <div class="header"><div class="school">${esc(schoolName)}</div><div class="doc-title">Staff Payslip</div></div>
  <div class="meta">
    <div><b>Staff:</b> ${esc(p.staff_name)}</div>
    <div><b>ID / Reg:</b> ${esc(p.staff_registration_id || s?.registration_id || '—')}</div>
    <div><b>Type:</b> ${esc(p.staff_type === 'teacher' ? 'Teacher' : 'Accountant')}</div>
    <div><b>Period:</b> ${esc(monthLabel)} ${p.pay_year}</div>
    <div><b>Term:</b> ${esc(TERM_LABELS[p.term] || p.term || '—')} · ${esc(p.academic_year || '—')}</div>
    <div><b>Generated:</b> ${new Date().toLocaleDateString('en-GB')}</div>
  </div>
  <table>
    <tr><th>Basic Salary</th><td class="right">${cedi(p.basic_salary)}</td></tr>
    <tr><th>Housing Allowance</th><td class="right">${cedi(p.allowance_housing)}</td></tr>
    <tr><th>Transport Allowance</th><td class="right">${cedi(p.allowance_transport)}</td></tr>
    <tr><th>Other Allowance</th><td class="right">${cedi(p.allowance_other)}</td></tr>
    <tr class="total-row"><td>Gross Pay</td><td class="right">${cedi(gross)}</td></tr>
    <tr><th>Tax Deduction</th><td class="right">${cedi(p.deduction_tax)}</td></tr>
    <tr><th>SSNIT Deduction</th><td class="right">${cedi(p.deduction_ssnit)}</td></tr>
    <tr><th>Loan Deduction</th><td class="right">${cedi(p.deduction_loan)}</td></tr>
    <tr><th>Other Deduction</th><td class="right">${cedi(p.deduction_other)}</td></tr>
    <tr class="total-row"><td>Total Deductions</td><td class="right">${cedi(deductions)}</td></tr>
    <tr class="net-row"><td>Net Pay</td><td class="right">${cedi(net)}</td></tr>
  </table>
  ${p.notes ? `<p><b>Notes:</b> ${esc(p.notes)}</p>` : ''}
  <div class="sig"><div>Prepared by (Accounts)</div><div>Authorised by (Head of School)</div><div>Received by (Staff)</div></div>
  <p style="font-size:9px;color:#888;margin-top:22px;text-align:center;">Generated by ${esc(schoolName)} Staff Admission Portal — ${new Date().toLocaleDateString()}</p>
</body></html>`;
    openPrintWindow(`Payslip - ${esc(p.staff_name)} - ${monthLabel} ${p.pay_year}`, html);
  };

  const printAllPeriod = async () => {
    if (periodPayslips.length === 0) {
      toast.error('No payslips found for the selected period.');
      return;
    }
    setPrintingAll(true);
    try {
      const rowsHtml = periodPayslips.map((p) => {
        const s = staffById[p.staff_id];
        const b = money(p.basic_salary);
        const h = money(p.allowance_housing);
        const t = money(p.allowance_transport);
        const o = money(p.allowance_other);
        const tx = money(p.deduction_tax);
        const ss = money(p.deduction_ssnit);
        const ln = money(p.deduction_loan);
        const od = money(p.deduction_other);
        const gross = b + h + t + o;
        const deductions = tx + ss + ln + od;
        const net = money(p.net_pay);
        return `<tr>
          <td style="border:1px solid #999;padding:5px 7px;font-size:11px;">${esc(p.staff_name)}</td>
          <td style="border:1px solid #999;padding:5px 7px;font-size:11px;">${esc(p.staff_registration_id || s?.registration_id || '—')}</td>
          <td style="border:1px solid #999;padding:5px 7px;font-size:11px;text-align:right;">${cedi(p.basic_salary)}</td>
          <td style="border:1px solid #999;padding:5px 7px;font-size:11px;text-align:right;">${cedi(h + t + o)}</td>
          <td style="border:1px solid #999;padding:5px 7px;font-size:11px;text-align:right;">${cedi(deductions)}</td>
          <td style="border:1px solid #999;padding:5px 7px;font-size:11px;text-align:right;font-weight:700;">${cedi(net)}</td>
        </tr>`;
      }).join('');
      const totalNet = periodPayslips.reduce((acc, p) => acc + money(p.net_pay), 0);
      const schoolName = (window.__schoolName || 'School');
      const label = `${monthFilter ? MONTHS.find((m) => m.value === Number(monthFilter))?.label : 'All'} ${yearFilter || nowYear}`;
      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Payslips - ${esc(label)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 24px; }
  .header { text-align: center; border-bottom: 3px double #111; padding-bottom: 12px; margin-bottom: 16px; }
  .school { font-size: 17px; font-weight: 700; letter-spacing: 1px; }
  .doc-title { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #666; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; }
  th, td { border: 1px solid #999; padding: 6px 8px; font-size: 11.5px; text-align: left; }
  th { background: #f1f5f9; font-weight: 700; text-align: right; }
  .right { text-align: right; }
  .total-row td { font-weight: 700; background: #f8fafc; border-top: 2px solid #333; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <div class="header"><div class="school">${esc(schoolName)}</div><div class="doc-title">Payslips — ${esc(label)}</div></div>
  <p style="font-size:11px;color:#444;margin-bottom:10px;">${esc(schoolName)} · ${periodPayslips.length} staff member(s) · ${new Date().toLocaleDateString('en-GB')}</p>
  <table>
    <thead><tr>
      <th style="width:26%;">Staff Name</th>
      <th style="width:16%;">ID / Reg</th>
      <th style="width:14%;" class="right">Basic Salary</th>
      <th style="width:14%;" class="right">Allowances</th>
      <th style="width:14%;" class="right">Deductions</th>
      <th style="width:16%;" class="right">Net Pay</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
    <tr class="total-row"><td colspan="5" class="right">Total Net Pay</td><td class="right">${cedi(totalNet)}</td></tr>
  </table>
  <p style="font-size:9px;color:#888;margin-top:18px;text-align:center;">Generated by ${esc(schoolName)} Staff Admission Portal</p>
</body></html>`;
      openPrintWindow(`Payslips - ${esc(label)}`, html);
      await logActivityForCurrentUser(`Printed all payslips for ${label}`, {
        entityType: 'payslip',
        entityDetails: `${periodPayslips.length} payslips · Total net ${cedi(totalNet)}`,
      });
    } finally {
      setPrintingAll(false);
    }
  };

  const exportCSV = () => {
    const rows = [['Staff Name', 'Registration ID', 'Type', 'Month', 'Year', 'Basic Salary', 'Allowances', 'Deductions', 'Net Pay', 'Notes']];
    periodPayslips.forEach((p) => {
      const s = staffById[p.staff_id];
      const allowances = money(p.allowance_housing) + money(p.allowance_transport) + money(p.allowance_other);
      const deductions = money(p.deduction_tax) + money(p.deduction_ssnit) + money(p.deduction_loan) + money(p.deduction_other);
      rows.push([
        p.staff_name, p.staff_registration_id || s?.registration_id || '',
        p.staff_type === 'teacher' ? 'Teacher' : 'Accountant',
        p.pay_month, p.pay_year,
        p.basic_salary, allowances, deductions, p.net_pay, p.notes || '',
      ]);
    });
    const csv = buildCSV(rows);
    const label = `${monthFilter ? MONTHS.find((m) => m.value === Number(monthFilter))?.label : 'all'}-${yearFilter || nowYear}`;
    downloadCSV(`payslips-${label}.csv`, csv);
    toast.success(`Exported ${periodPayslips.length} payslip(s) to CSV`);
  };

  const renderPhoto = (s) => {
    if (s?.photo_url) {
      return <img src={s.photo_url} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-slate-100" />;
    }
    const initials = (s?.full_name || 'S').split(/\s+/).map((w) => w.charAt(0).toUpperCase()).slice(0, 2).join('');
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-600">
        {initials}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Payslips"
        subtitle="Generate, edit and print payslips for teachers and accountants."
        icon={CreditCard}
        actions={
          <div className="flex items-center gap-2 sm:gap-3">
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Generate Payslip
            </Button>
            {periodPayslips.length ? (
              <div className="flex items-center gap-2">
                <Button onClick={printAllPeriod} loading={printingAll} size="sm" variant="outline">
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  Print Month
                </Button>
                <Button onClick={exportCSV} size="sm" variant="outline">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  CSV
                </Button>
              </div>
            ) : null}
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="col-span-1 md:col-span-2">
          <Card className="p-0">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              Pay period filter
            </div>
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label block text-xs text-slate-500 mb-1">Month</label>
                <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                  <option value="">All months</option>
                  {MONTHS.map((m) => (
                    <option key={m.value} value={String(m.value)}>{m.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="label block text-xs text-slate-500 mb-1">Year</label>
                <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                  <option value="">All years</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-end">
                <Button variant="secondary" size="sm" onClick={() => { setMonthFilter(''); setYearFilter(''); }} className="w-full">
                  Reset
                </Button>
              </div>
            </div>
            <div className="px-4 py-2">
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search staff by name, registration ID, email or phone…"
              />
            </div>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-3 pr-2 font-semibold">Staff</th>
                    <th className="pb-3 text-right font-semibold">Reg. ID</th>
                    <th className="pb-3 text-right font-semibold w-20">Type</th>
                    <th className="pb-3 text-right font-semibold w-24">Latest Net Pay</th>
                    <th className="pb-3 text-right font-semibold w-28">Period</th>
                    <th className="pb-3 text-right font-semibold w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStaff.length ? (
                    filteredStaff.map((s) => {
                      const latest = latestPayslipFor(s);
                      return (
                        <tr key={s.id} className="hover:bg-slate-50 group">
                          <td className="py-3 pr-2">
                            <div className="flex items-center gap-3">
                              {renderPhoto(s)}
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{s.full_name}</p>
                                <p className="text-xs text-slate-400 truncate">{s.email || s.phone || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-right text-xs font-mono text-slate-400">{s.registration_id || '—'}</td>
                          <td className="py-3 text-right">
                            <Badge tone={s.staff_type === 'teacher' ? 'blue' : 'teal'} className="text-xs">
                              {s.staff_type === 'teacher' ? 'Teacher' : 'Accountant'}
                            </Badge>
                          </td>
                          <td className="py-3 text-right">
                            {latest ? (
                              <span className="font-semibold text-slate-800">{cedi(latest.net_pay)}</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 text-right text-xs text-slate-400">
                            {latest ? `${MONTHS.find((m) => m.value === latest.pay_month)?.label} ${latest.pay_year}` : '—'}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {latest ? (
                                <>
                                  <Button size="sm" variant="ghost" onClick={() => { setViewing(latest); }} title="View payslip">
                                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => openEdit(latest)} title="Edit payslip">
                                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setDeleting(latest); }} title="Delete payslip">
                                    <Trash2 className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
                                  </Button>
                                </>
                              ) : (
                                <Button size="sm" onClick={() => openEdit(null)} title="Generate payslip">
                                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 text-sm">
                        No staff found. Add teachers or accountants first.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {periodPayslips.length === 0 && payslips.length > 0 && (
              <div className="px-4 py-4 text-center text-xs text-slate-400">
                No payslips for the selected period. Use &ldquo;Generate Payslip&rdquo; to create one.
              </div>
            )}
          </Card>
        </div>
              <div className="col-span-1 md:col-span-1">
          <Card>
            <div className="p-4">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Period Summary</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-500">Staff with payslips</span>
                  <span className="text-sm font-semibold text-slate-800">{new Set(periodPayslips.map((p) => p.staff_id)).size}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-500">Total net pay</span>
                  <span className="text-sm font-semibold text-slate-800">{cedi(periodPayslips.reduce((a, p) => a + money(p.net_pay), 0))}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-500">Period</span>
                  <span className="text-sm font-semibold text-slate-800">
                    {monthFilter ? MONTHS.find((m) => m.value === Number(monthFilter))?.label : 'All'} {yearFilter || nowYear}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-xs text-slate-500 mb-2">Quick actions</p>
                <Button onClick={openAdd} className="w-full" size="sm">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New payslip
                </Button>
                {periodPayslips.length ? (
                  <>
                    <Button onClick={printAllPeriod} loading={printingAll} size="sm" variant="outline" className="w-full mt-2">
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print period
                    </Button>
                    <Button onClick={exportCSV} size="sm" variant="outline" className="w-full mt-2">
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      </div>
          <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit payslip' : 'Generate payslip'}
        size="lg"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={save} loading={busy} className="flex-1">
              {editing ? 'Save changes' : 'Generate payslip'}
            </Button>
          </div>
        }
      >
        {error ? (
          <Alert tone="error" className="mb-4">{error}</Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label block text-xs text-slate-500 mb-1">Staff member *</label>
            <Select
              value={form.staff_id}
              onChange={(e) => {
                const id = e.target.value;
                const s = staff.find((x) => x.id === id);
                if (s) {
                  setForm((f) => ({
                    ...f,
                    staff_id: s.id,
                    staff_type: s.staff_type,
                    staff_name: s.full_name,
                    staff_registration_id: s.registration_id || '',
                  }));
                } else {
                  setForm((f) => ({ ...f, staff_id: id }));
                }
              }}
            >
              <option value="">Select a staff member…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.staff_type === 'teacher' ? 'Teacher' : 'Accountant'}) · {s.registration_id || '—'}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="label block text-xs text-slate-500 mb-1">Pay month *</label>
            <Select value={form.pay_month} onChange={set('pay_month')}>
              {MONTHS.map((m) => (
                <option key={m.value} value={String(m.value)}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="label block text-xs text-slate-500 mb-1">Pay year *</label>
            <Select value={form.pay_year} onChange={set('pay_year')}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="label block text-xs text-slate-500 mb-1">Term</label>
            <Select value={form.term} onChange={set('term')}>
              {TERMS.map((t) => (
                <option key={t} value={t}>{TERM_LABELS[t]}</option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <label className="label block text-xs text-slate-500 mb-1">Academic year</label>
            <Input value={form.academic_year} onChange={set('academic_year')} placeholder="e.g. 2026/2027" />
          </div>
        </div>
        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Earnings</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><Input type="number" label="Basic salary" value={form.basic_salary} onChange={set('basic_salary')} /></div>
            <div><Input type="number" label="Housing allowance" value={form.allowance_housing} onChange={set('allowance_housing')} /></div>
            <div><Input type="number" label="Transport allowance" value={form.allowance_transport} onChange={set('allowance_transport')} /></div>
            <div><Input type="number" label="Other allowance" value={form.allowance_other} onChange={set('allowance_other')} /></div>
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 mt-4">Deductions</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div><Input type="number" label="Tax" value={form.deduction_tax} onChange={set('deduction_tax')} /></div>
            <div><Input type="number" label="SSNIT" value={form.deduction_ssnit} onChange={set('deduction_ssnit')} /></div>
            <div><Input type="number" label="Loan" value={form.deduction_loan} onChange={set('deduction_loan')} /></div>
            <div><Input type="number" label="Other deduction" value={form.deduction_other} onChange={set('deduction_other')} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50">
                <span className="text-xs text-slate-500">Net pay (auto-calculated)</span>
                <span className="text-sm font-semibold text-slate-800">{cedi(computeNet().net)}</span>
              </div>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Input label="Notes" value={form.notes} onChange={set('notes')} placeholder="Optional notes…" />
          </div>
        </div>
      </Modal>
          <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={`Payslip — ${viewing?.staff_name}`}
        size="lg"
      >
        {(() => {
          const p = viewing;
          if (!p) return null;
          const s = staffById[p.staff_id];
          const b = money(p.basic_salary);
          const h = money(p.allowance_housing);
          const t = money(p.allowance_transport);
          const o = money(p.allowance_other);
          const tx = money(p.deduction_tax);
          const ss = money(p.deduction_ssnit);
          const ln = money(p.deduction_loan);
          const od = money(p.deduction_other);
          const gross = b + h + t + o;
          const deductions = tx + ss + ln + od;
          const net = money(p.net_pay);
          return (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4 text-xs text-slate-500">
                <div><span className="font-semibold text-slate-700">Staff:</span> {esc(p.staff_name)}</div>
                <div><span className="font-semibold text-slate-700">Type:</span> {p.staff_type === 'teacher' ? 'Teacher' : 'Accountant'}</div>
                <div><span className="font-semibold text-slate-700">Reg. ID:</span> {esc(p.staff_registration_id || s?.registration_id || '—')}</div>
                <div><span className="font-semibold text-slate-700">Period:</span> {MONTHS.find((m) => m.value === p.pay_month)?.label} {p.pay_year}</div>
                <div><span className="font-semibold text-slate-700">Term:</span> {TERM_LABELS[p.term] || p.term} · {esc(p.academic_year || '—')}</div>
                <div><span className="font-semibold text-slate-700">Created:</span> {formatDate(p.created_at)}</div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <table className="w-full text-left">
                  <tr><td className="w-1/3 font-semibold text-slate-600">Basic Salary</td><td className="text-right">{cedi(p.basic_salary)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">Housing Allowance</td><td className="text-right">{cedi(p.allowance_housing)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">Transport Allowance</td><td className="text-right">{cedi(p.allowance_transport)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">Other Allowance</td><td className="text-right">{cedi(p.allowance_other)}</td></tr>
                  <tr><td className="font-bold border-t border-slate-200 pt-2">Gross Pay</td><td className="text-right font-bold border-t border-slate-200 pt-2">{cedi(gross)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">Tax Deduction</td><td className="text-right">{cedi(p.deduction_tax)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">SSNIT Deduction</td><td className="text-right">{cedi(p.deduction_ssnit)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">Loan Deduction</td><td className="text-right">{cedi(p.deduction_loan)}</td></tr>
                  <tr><td className="font-semibold text-slate-600">Other Deduction</td><td className="text-right">{cedi(p.deduction_other)}</td></tr>
                  <tr><td className="font-bold border-t border-slate-200 pt-2">Total Deductions</td><td className="text-right font-bold border-t border-slate-200 pt-2">{cedi(deductions)}</td></tr>
                  <tr><td className="font-bold text-brand-700 border-t border-brand-200 pt-2">Net Pay</td><td className="text-right font-bold text-brand-700 border-t border-brand-200 pt-2">{cedi(net)}</td></tr>
                </table>
              </div>
              {p.notes ? (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-xs text-amber-800"><b>Notes:</b> {esc(p.notes)}</p>
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="secondary" onClick={() => setViewing(null)} className="flex-1">
                  Close
                </Button>
                <Button onClick={() => { setViewing(null); printPayslip(p); }}>
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Print payslip
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete payslip?"
        message={`This permanently removes the payslip for ${deleting?.staff_name || ''} (${deleting?.pay_month}/${deleting?.pay_year}). This cannot be undone.`}
        confirmLabel="Delete payslip"
      />
    </div>
  );
}

