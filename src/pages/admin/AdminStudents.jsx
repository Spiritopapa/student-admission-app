import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, UserPlus, Eye, Trash2, Pencil, Printer, ArrowUp, Upload, Download,
  FileDown, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { useSchoolId, useSchoolSettings } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Button, Input, Select, Badge, Spinner, EmptyState, SearchInput, Card } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { PhotoUpload } from '../../components/PhotoUpload';
import { supabase } from '../../lib/supabase';
import { uploadFile, randomPath, photoUrl, deleteStoredFiles } from '../../lib/storage';
import { GENDERS, RELIGIONS, TERMS, CLASS_LEVELS, currentAcademicYear } from '../../lib/constants';
import { buildStudentName, formatDate, formatDateTime, termLabel, formatCurrency } from '../../lib/format';
import { fetchClassFees, fetchAdmissionItems } from '../../lib/queries';
import { openPrintWindow, escapeHtml } from '../../lib/print';
import { openAdmissionForm } from '../../lib/admissionForm';
import { buildCSV, parseCSV, downloadCSV } from '../../lib/csv';

const emptyForm = {
  first_name: '',
  middle_name: '',
  last_name: '',
  class_applying: '',
  term: 'First',
  admission_date: '',
  date_of_birth: '',
  gender: 'Male',
  religion: 'Christian',
  parent_name: '',
  parent_contact: '',
  home_town: '',
  place_of_stay: '',
  previous_school: '',
};

// The canonical set of columns used by BOTH the export template and the
// import parser (mirrors the legacy vanilla app). Keeping them in sync
// guarantees that any file downloaded from the app can be edited and
// imported back without surprises.
const STUDENT_CSV_HEADERS = [
  'Student ID', 'First Name', 'Middle Name', 'Last Name', 'Class',
  'Term', 'Gender', 'Date of Birth', 'Religion', 'Parent Name',
  'Parent Contact', 'Home Town', 'Place of Stay', 'Teacher',
  'Previous School', 'Admission Date', 'Status', 'Portal Confirmed',
];

// Accepted synonyms for each column (case-insensitive). Excel users sometimes
// rename headers, so we normalise them instead of failing the import.
const STUDENT_CSV_ALIASES = {
  'Student ID': ['Student ID', 'student_id', 'Student_Id', 'StudentId', 'ID'],
  'First Name': ['First Name', 'first_name', 'Firstname'],
  'Middle Name': ['Middle Name', 'middle_name', 'Middlename'],
  'Last Name': ['Last Name', 'last_name', 'Lastname', 'Surname'],
  Class: ['Class', 'Class Applying', 'Class/Form', 'Form/Class', 'Grade', 'class_applying'],
  Term: ['Term'],
  Gender: ['Gender'],
  'Date of Birth': ['Date of Birth', 'DOB', 'Birth Date', 'date_of_birth'],
  Religion: ['Religion'],
  'Parent Name': ['Parent Name', 'Guardian Name', 'Parent/Guardian Name', 'parent_name'],
  'Parent Contact': ['Parent Contact', 'Parent Phone', 'Parent Telephone', 'Contact', 'parent_contact'],
  'Home Town': ['Home Town', 'Hometown', 'home_town'],
  'Place of Stay': ['Place of Stay', 'Residence', 'place_of_stay'],
  Teacher: ['Teacher', 'Class Teacher', 'Form Teacher'],
  'Previous School': ['Previous School', 'PreviousSchool', 'previous_school'],
  'Admission Date': ['Admission Date', 'admission_date', 'Date Admitted'],
  Status: ['Status'],
  'Portal Confirmed': ['Portal Confirmed', 'Portal', 'Portal Confirmed?'],
};

const STUDENT_STATUSES = ['pending', 'admitted'];
const PORTAL_YES = new Set(['yes', 'true', '1', 'y', 'confirmed', 'confirm']);

// Normalise an enum value (gender / religion / term / status) to its canonical
// spelling, falling back to `fallback` when the cell is blank.
function normalizeEnum(value, allowed, fallback) {
  const v = String(value ?? '').trim();
  if (!v) return { value: fallback, error: null };
  const hit = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  if (hit) return { value: hit, error: null };
  return { value: v, error: `"${v}" is not valid. Use one of: ${allowed.join(', ')}.` };
}

// Normalise a date cell into YYYY-MM-DD. Handles Excel serial dates and the
// common DD/MM/YYYY style in addition to the canonical ISO form.
function normalizeDateCell(raw, label) {
  const v = String(raw ?? '').trim().replace(/\.0+$/, '');
  if (!v) return { value: null, error: null };
  // Excel serial date (days since 1899-12-30).
  if (/^\d{4,6}$/.test(v) && Number(v) >= 25569) {
    const dt = new Date(Math.round((Number(v) - 25569) * 86400000));
    if (!Number.isNaN(dt.getTime())) return { value: dt.toISOString().slice(0, 10), error: null };
  }
  // Canonical YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { value: v, error: null };
  // DD/MM/YYYY or DD-MM-YYYY.
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, error: null };
    }
  }
  return { value: v, error: `${label} "${v}" is not a valid date. Use YYYY-MM-DD.` };
}
// Some spreadsheet apps prefix text cells with an apostrophe (e.g. "'0551234567");
// strip it so phone numbers / IDs import cleanly.
function scrubCell(raw) {
  const v = String(raw ?? '');
  return v.startsWith("'") ? v.slice(1) : v;
}

// Run a bounded number of async operations at once (used to generate student
// IDs without flooding the server with hundreds of simultaneous RPC calls).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export default function AdminStudents() {
  const schoolId = useSchoolId();
  const { settings } = useSchoolSettings();
  const toast = useToast();
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');

  const [admitOpen, setAdmitOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [photoFile, setPhotoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Term fees on the Admit Student form: the auto-filled class (term) fee plus
  // one amount input per admission item configured in Settings. The item
  // amounts are added to the class fee to form the student's total term fee.
  const [classFeeAmount, setClassFeeAmount] = useState(0);
  const [admissionItems, setAdmissionItems] = useState([]);
  const [itemAmounts, setItemAmounts] = useState({});

  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editPhotoFile, setEditPhotoFile] = useState(null);
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(null);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteSelected, setPromoteSelected] = useState(() => new Set());
  const [promoteTarget, setPromoteTarget] = useState('');
  const [promoteBusy, setPromoteBusy] = useState(false);

  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [{ data: studentsData }, { data: classesData }] = await Promise.all([
        supabase
          .from('applications')
          .select('*')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false }),
        supabase.from('classes').select('id, name, level').eq('school_id', schoolId).order('name'),
      ]);
      setStudents(studentsData || []);
      setClasses(classesData || []);
    } catch (err) {
      toast.error('Could not load students', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (schoolId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const filtered = useMemo(
    () =>
      students.filter((s) => {
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name).toLowerCase();
        const matchesQuery =
          !query ||
          name.includes(query.toLowerCase()) ||
          (s.student_id || '').toLowerCase().includes(query.toLowerCase()) ||
          (s.parent_contact || '').toLowerCase().includes(query.toLowerCase());
        const matchesClass = !classFilter || s.class_applying === classFilter;
        const matchesGender = !genderFilter || (s.gender || 'Male') === genderFilter;
        return matchesQuery && matchesClass && matchesGender;
      }),
    [students, query, classFilter, genderFilter]
  );

  // Classes ordered by level then name so the promote modal can pre-select the
  // "next" class in the school's progression.
  const orderedClasses = useMemo(() => {
    const levelOrder = Object.fromEntries(CLASS_LEVELS.map((level, i) => [level, i]));
    return [...classes].sort(
      (a, b) => (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99) || a.name.localeCompare(b.name)
    );
  }, [classes]);

  const promoteTargetOptions = useMemo(
    () => orderedClasses.filter((c) => !classFilter || c.name !== classFilter),
    [orderedClasses, classFilter]
  );

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setEdit = (key) => (e) => setEditForm((f) => ({ ...f, [key]: e.target.value }));

  // Resolve the class (term) fee for a class + term. The school's current
  // academic year (from Settings) is tried first; when no fee structure row
  // exists there, the runtime-computed current academic year is used as a
  // fallback so the fee still loads even if the school's Settings year lags.
  const resolveClassFee = async (className, termName) => {
    if (!schoolId || !className) return { amount: 0, year: settings?.academic_year || currentAcademicYear() };
    const settingsYear = settings?.academic_year || currentAcademicYear();
    let classFee = await fetchClassFees(schoolId, className, settingsYear, termName);
    let year = settingsYear;
    if (!classFee) {
      const runtimeYear = currentAcademicYear();
      if (runtimeYear !== settingsYear) {
        classFee = await fetchClassFees(schoolId, className, runtimeYear, termName);
        if (classFee) year = runtimeYear;
      }
    }
    return classFee
      ? { amount: Number(classFee.fee_amount) || 0, year: classFee.academic_year || year }
      : { amount: 0, year: settingsYear };
  };

  // Load the class (term) fee (from the class_fees fee structure) and the
  // active admission items (from Settings) into the admit form. Re-runs every
  // time the admit modal opens or the selected class / term changes.
  const loadAdmitFees = async () => {
    if (!schoolId || !admitOpen) return;
    setClassFeeAmount(0);
    setAdmissionItems([]);
    setItemAmounts({});
    if (!form.class_applying) return;
    try {
      const { amount } = await resolveClassFee(form.class_applying, form.term);
      const items = await fetchAdmissionItems(schoolId);
      const activeItems = (items || []).filter((it) => it.is_active !== false);
      setClassFeeAmount(amount);
      setAdmissionItems(activeItems);
      const amounts = {};
      activeItems.forEach((it) => {
        amounts[it.id] = Number(it.amount) || 0;
      });
      setItemAmounts(amounts);
    } catch (err) {
      console.warn('Failed to load class fee / admission items for admit form:', err.message);
    }
  };

  useEffect(() => {
    if (admitOpen) loadAdmitFees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admitOpen, form.class_applying, form.term, settings?.academic_year, settings?.current_term]);

  // Live total = class (term) fee + every entered admission item amount.
  const admittedTotalFee = classFeeAmount + admissionItems.reduce(
    (sum, it) => sum + (Number(itemAmounts[it.id]) || 0),
    0
  );

  // Open the admit form, pre-selecting the school's CURRENT term (instead of
  // always "First") so the auto-filled class fee is the current term's fee,
  // and defaulting the admission date to today.
  const openAdmitModal = () => {
    setForm((f) => ({
      ...f,
      term: settings?.current_term || f.term || 'First',
      admission_date: f.admission_date || new Date().toISOString().split('T')[0],
    }));
    setAdmitOpen(true);
  };

const admitStudent = async () => {
    setFormError('');
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setFormError('First and last name are required.');
      return;
    }
    if (!form.class_applying) {
      setFormError('Please select a class.');
      return;
    }
    if (!form.date_of_birth) {
      setFormError('Date of birth is required.');
      return;
    }
    if (!form.parent_name.trim() || !form.parent_contact.trim()) {
      setFormError('Parent name and contact are required.');
      return;
    }
    setBusy(true);
    try {
      const { data: studentId, error: idError } = await supabase.rpc('generate_student_id');
      if (idError || !studentId) throw new Error('Could not generate a student ID.');

      let photoValue = null;
      if (photoFile) {
        photoValue = await uploadFile(
          'student-photos',
          randomPath(`students/${studentId}`, photoFile.name),
          photoFile
        );
      }

      const { error: insertError } = await supabase.from('applications').insert([
        {
          student_id: studentId,
          school_id: schoolId,
          first_name: form.first_name.trim(),
          middle_name: form.middle_name.trim() || null,
          last_name: form.last_name.trim(),
          class_applying: form.class_applying,
          admission_date: form.admission_date || new Date().toISOString().split('T')[0],
          date_of_birth: form.date_of_birth,
          gender: form.gender,
          religion: form.religion,
          previous_school: form.previous_school.trim() || null,
          parent_name: form.parent_name.trim(),
          parent_contact: form.parent_contact.trim(),
          home_town: form.home_town.trim() || null,
          place_of_stay: form.place_of_stay.trim() || null,
          term: form.term,
          student_photo_url: photoValue,
          status: 'admitted',
        },
      ]);
      if (insertError) throw new Error(insertError.message);

      // Fee record: the class (term) fee from the fee structure is auto-applied
      // and every admission item amount entered on the form is added on top of
      // it. The itemized breakdown is snapshotted into fee_breakdown so the
      // admission form, receipts and fee records all agree on the totals.
      const resolvedFee = await resolveClassFee(form.class_applying, form.term);
      const feeYear = resolvedFee.year;
      const classFeeAmountFinal = Number(classFeeAmount) || resolvedFee.amount || 0;

      const breakdownItems = [];
      let totalAmount = classFeeAmountFinal;
      admissionItems.forEach((it) => {
        const amt = Number(itemAmounts[it.id]) || 0;
        if (amt > 0) breakdownItems.push({ name: it.name || 'Additional Fee', amount: amt });
        totalAmount += amt;
      });
      const feeBreakdown = {
        class_fee: classFeeAmountFinal,
        items: breakdownItems,
        academic_year: feeYear,
        term: form.term,
        generated_at: new Date().toISOString(),
      };

      await supabase
        .from('fees')
        .upsert(
          [
            {
              student_id: studentId,
              academic_year: feeYear,
              term: form.term,
              total_amount: totalAmount,
              amount_paid: 0,
              debt: 0,
              payment_status: totalAmount > 0 ? 'unpaid' : 'paid',
              last_payment_date: null,
              school_id: schoolId,
              fee_breakdown: feeBreakdown,
            },
          ],
          { onConflict: 'student_id,academic_year,term' }
        );

      toast.success('Student admitted', `Student ID ${studentId} created.`);

      // Auto-open the printable Student Admission Form with ALL student
      // information, the class fee, the additional items and the total term fee.
      try {
        const { data: admittedStudent } = await supabase
          .from('applications')
          .select('*')
          .eq('student_id', studentId)
          .maybeSingle();
        if (admittedStudent) {
          const studentName = buildStudentName(admittedStudent.first_name, admittedStudent.middle_name, admittedStudent.last_name);
          openAdmissionForm(
            {
              studentId,
              student: admittedStudent,
              schoolName: settings?.school_name || 'My School',
              schoolLogoUrl: settings?.logo_url || '',
              academicYear: feeYear,
              term: form.term,
              classFee: classFeeAmountFinal,
              items: breakdownItems,
              totalAmount,
              includeFees: true,
            },
            `Admission Form - ${studentName}`
          );
        }
      } catch (genErr) {
        console.warn('Failed to auto-generate admission form:', genErr.message);
      }

      setAdmitOpen(false);
      setForm(emptyForm);
      setPhotoFile(null);
      setClassFeeAmount(0);
      setAdmissionItems([]);
      setItemAmounts({});
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };
const openEdit = (s) => {
    setEditing(s);
    setEditForm({
      first_name: s.first_name || '',
      middle_name: s.middle_name || '',
      last_name: s.last_name || '',
      class_applying: s.class_applying || '',
      term: s.term || 'First',
      date_of_birth: s.date_of_birth ? String(s.date_of_birth).slice(0, 10) : '',
      gender: s.gender || 'Male',
      religion: s.religion || 'Christian',
      parent_name: s.parent_name || '',
      parent_contact: s.parent_contact || '',
      home_town: s.home_town || '',
      place_of_stay: s.place_of_stay || '',
      previous_school: s.previous_school || '',
      teacher: s.teacher || '',
      admission_date: s.admission_date ? String(s.admission_date).slice(0, 10) : '',
      status: s.status || 'admitted',
    });
    setEditPhotoFile(null);
    setEditPhotoRemoved(false);
    setEditError('');
  };

  const closeEdit = () => {
    setEditing(null);
    setEditPhotoFile(null);
    setEditPhotoRemoved(false);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditError('');
    if (!editForm.first_name.trim() || !editForm.last_name.trim()) {
      setEditError('First and last name are required.');
      return;
    }
    if (!editForm.class_applying) {
      setEditError('Please select a class.');
      return;
    }
    if (!editForm.date_of_birth) {
      setEditError('Date of birth is required.');
      return;
    }
    if (!editForm.parent_name.trim() || !editForm.parent_contact.trim()) {
      setEditError('Parent name and contact are required.');
      return;
    }
    setEditBusy(true);
    try {
      const oldPhoto = editing.student_photo_url || null;
      let photoValue = oldPhoto;
      if (editPhotoFile) {
        photoValue = await uploadFile(
          'student-photos',
          randomPath(`students/${editing.student_id}`, editPhotoFile.name),
          editPhotoFile
        );
      } else if (editPhotoRemoved) {
        photoValue = null;
      }

      const { error: updateError } = await supabase
        .from('applications')
        .update({
          first_name: editForm.first_name.trim(),
          middle_name: editForm.middle_name.trim() || null,
          last_name: editForm.last_name.trim(),
          class_applying: editForm.class_applying,
          term: editForm.term,
          date_of_birth: editForm.date_of_birth,
          gender: editForm.gender,
          religion: editForm.religion,
          previous_school: editForm.previous_school.trim() || null,
          parent_name: editForm.parent_name.trim(),
          parent_contact: editForm.parent_contact.trim(),
          home_town: editForm.home_town.trim() || null,
          place_of_stay: editForm.place_of_stay.trim() || null,
          teacher: editForm.teacher.trim() || null,
          admission_date: editForm.admission_date || null,
          status: editForm.status,
          student_photo_url: photoValue,
          updated_at: new Date().toISOString(),
        })
        .eq('student_id', editing.student_id)
        .eq('school_id', schoolId);
      if (updateError) throw new Error(updateError.message);

      // Clean up the previous photo asset (best effort) after the row is saved.
      if (oldPhoto && (editPhotoFile || editPhotoRemoved) && oldPhoto.startsWith('student-photos/')) {
        try {
          await deleteStoredFiles([oldPhoto]);
        } catch (err) {
          console.warn('Old photo cleanup skipped:', err.message);
        }
      }

      toast.success('Student updated', buildStudentName(editForm.first_name, editForm.middle_name, editForm.last_name));
      closeEdit();
      load();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('delete_student_completely', {
        p_student_id: deleting.student_id,
      });
      if (error) throw new Error(error.message);
      toast.success(
        'Student removed',
        `${buildStudentName(deleting.first_name, deleting.middle_name, deleting.last_name)} was deleted together with related records.`
      );
      setDeleting(null);
      load();
    } catch (err) {
      toast.error('Could not delete student', err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  const confirmPortal = async (s) => {
    if (!s) return;
    setPortalBusy(s.student_id);
    try {
      const { error } = await supabase
        .from('applications')
        .update({ portal_confirmed: true, sub_admin_approved: true })
        .eq('student_id', s.student_id)
        .eq('school_id', schoolId);
      if (error) throw new Error(error.message);
      toast.success('Portal confirmed', `${buildStudentName(s.first_name, s.middle_name, s.last_name)} can now sign in to the student portal.`);
      load();
    } catch (err) {
      toast.error('Could not confirm portal', err.message);
    } finally {
      setPortalBusy(null);
    }
  };
const openPromote = () => {
    let next = '';
    if (classFilter) {
      const idx = orderedClasses.findIndex((c) => c.name === classFilter);
      if (idx >= 0 && idx + 1 < orderedClasses.length) next = orderedClasses[idx + 1].name;
    }
    setPromoteTarget(next);
    setPromoteSelected(new Set());
    setPromoteOpen(true);
  };

  const toggleStudent = (id) => {
    setPromoteSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllPromote = (checked) => {
    setPromoteSelected(checked ? new Set(filtered.map((s) => s.student_id)) : new Set());
  };

  const submitPromote = async () => {
    if (!promoteTarget) {
      toast.error('No target class', 'Select the class to promote students into.');
      return;
    }
    if (promoteSelected.size === 0) {
      toast.error('No students selected', 'Tick at least one student to promote.');
      return;
    }
    setPromoteBusy(true);
    let promoted = 0;
    let errors = 0;
    for (const studentId of promoteSelected) {
      try {
        const { error } = await supabase
          .from('applications')
          .update({ class_applying: promoteTarget, updated_at: new Date().toISOString() })
          .eq('student_id', studentId)
          .eq('school_id', schoolId);
        if (error) throw error;
        promoted += 1;
      } catch (err) {
        errors += 1;
        console.error('Error promoting student:', studentId, err);
      }
    }
    setPromoteBusy(false);
    toast.success(
      'Students promoted',
      `${promoted} student(s) moved to ${promoteTarget}.${errors ? ` ${errors} had errors.` : ''} Existing fee balances are kept intact.`
    );
    setPromoteOpen(false);
    load();
  };

  const studentsToCSV = (rows) => {
    const body = rows.map((s) => [
      s.student_id || '',
      s.first_name || '',
      s.middle_name || '',
      s.last_name || '',
      s.class_applying || '',
      s.term || '',
      s.gender || 'Male',
      s.date_of_birth || '',
      s.religion || 'Christian',
      s.parent_name || '',
      s.parent_contact || '',
      s.home_town || '',
      s.place_of_stay || '',
      s.teacher || '',
      s.previous_school || '',
      s.admission_date || '',
      s.status || 'admitted',
      s.portal_confirmed ? 'Yes' : 'No',
    ]);
    return buildCSV([STUDENT_CSV_HEADERS, ...body]);
  };

  const exportCSV = () => {
    if (!filtered.length) {
      toast.error('No students to export', 'Try adjusting the filters first.');
      return;
    }
    const suffix = classFilter
      ? classFilter.replace(/\s+/g, '_')
      : query
      ? 'search_results'
      : 'all_students';
    downloadCSV(`student_admission_template_${suffix}.csv`, studentsToCSV(filtered));
    toast.success('CSV exported', `${filtered.length} student(s) exported.`);
  };

  const downloadTemplate = () => {
    const example = [
      '', 'Ama', 'Akosua', 'Mensah', 'JHS 1A', 'First', 'Female', '2013-04-15', 'Christian',
      'Akosua Mensah', '0551234567', 'Kumasi', 'Deduako', '', "St. Mary's JHS", '2026-09-02',
      'admitted', 'No',
    ];
    downloadCSV('student_import_template.csv', buildCSV([STUDENT_CSV_HEADERS, example]));
    toast.success('Template downloaded', 'Fill in the rows (keep the header) and use Import CSV.');
  };

  const buildColumnMap = (headerRow) => {
    const colMap = {};
    const normalized = headerRow.map((h) =>
      String(h ?? '').replace(/\uFEFF/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
    );
    STUDENT_CSV_HEADERS.forEach((col) => {
      const names = (STUDENT_CSV_ALIASES[col] || [col]).map((n) => n.toLowerCase().replace(/\s+/g, ' '));
      const idx = normalized.findIndex((h) => names.includes(h));
      if (idx >= 0) colMap[col] = idx;
    });
    return colMap;
  };
const importCSV = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text).filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
      if (rows.length < 2) throw new Error('The file must have a header row and at least one data row.');

      const col = buildColumnMap(rows[0]);
      const requiredCols = ['First Name', 'Last Name', 'Class'];
      const missingCols = requiredCols.filter((c) => col[c] === undefined);
      if (missingCols.length) {
        throw new Error(`Missing required column(s): ${missingCols.join(', ')}. Download the CSV template to see the expected format.`);
      }

      const [{ data: existing }, { data: classFees }, { data: classRows }] = await Promise.all([
        supabase
          .from('applications')
          .select('student_id, first_name, last_name, date_of_birth, status')
          .eq('school_id', schoolId),
        supabase.from('class_fees').select('class_name, term, fee_amount, academic_year').eq('school_id', schoolId),
        supabase.from('classes').select('name').eq('school_id', schoolId),
      ]);
      const idSet = new Set((existing || []).map((r) => r.student_id));
      // Existing student status by student ID and by natural key
      // (first name + last name + date of birth) so the import can refuse to
      // re-create students who are already in the app.
      const statusById = new Map((existing || []).map((s) => [s.student_id, s.status || 'pending']));
      const existingKeys = new Map(
        (existing || [])
          .filter((s) => s.first_name && s.last_name && s.date_of_birth)
          .map((s) => [
            `${s.first_name.trim().toLowerCase()}|${s.last_name.trim().toLowerCase()}|${String(s.date_of_birth).slice(0, 10)}`,
            s.status || 'pending',
          ])
      );
      // Classes configured in the Classes module are the source of truth: rows
      // for classes that do not exist are blocked before any write happens.
      const configuredClassMap = new Map(
        (classRows || []).map((c) => [String(c.name).trim().toLowerCase(), String(c.name).trim()])
      );
      // Current academic year: imported students are auto-charged the CURRENT
      // class fee for their class + term (same rule as the Admit form). When a
      // class/term has multiple years on record, the current year wins; if the
      // current year has no fee row yet, any existing one is used as a fallback.
      const defaultAcademicYear = settings?.academic_year || currentAcademicYear();
      const feeMap = new Map(
        (classFees || []).map((f) => [
          `${String(f.class_name).trim().toLowerCase()}|||${f.term}`,
          { amount: Number(f.fee_amount) || 0, academic_year: f.academic_year },
        ])
      );
      (classFees || []).forEach((f) => {
        const key = `${String(f.class_name).trim().toLowerCase()}|||${f.term}`;
        const current = feeMap.get(key);
        if (current && f.academic_year === defaultAcademicYear && current.academic_year !== defaultAcademicYear) {
          feeMap.set(key, { amount: Number(f.fee_amount) || 0, academic_year: f.academic_year });
        }
      });

      const errors = [];
      // Rows that look like students already in the app (same name & DOB, or
      // same student ID). Their existing status decides whether the admin is
      // prompted to confirm before the rest of the import proceeds.
      const duplicates = [];
      const providedRows = [];
      const autoRows = [];

      rows.slice(1).forEach((cells, offset) => {
        const fileRow = offset + 2;
        const get = (name) => {
          const idx = col[name];
          return idx === undefined ? '' : scrubCell(cells[idx]);
        };
        const first = get('First Name').trim();
        const last = get('Last Name').trim();
        const className = get('Class').trim();
        if (!first && !last && !className) return; // skip fully blank rows

        if (!first || !last) {
          errors.push(`Row ${fileRow}: First name and last name are required.`);
          return;
        }
        if (!className) {
          errors.push(`Row ${fileRow}: Class is required for ${first} ${last}.`);
          return;
        }
        // The Classes module is the source of truth: block rows whose class the
        // school has not configured (case-insensitive, canonical name used).
        const canonicalClass = configuredClassMap.get(className.trim().toLowerCase());
        if (!canonicalClass) {
          const available = classRows && classRows.length
            ? ` ${classRows.slice(0, 12).map((c) => c.name).join(', ')}${classRows.length > 12 ? '…' : ''}`
            : ' none configured yet — add classes under Classes first.';
          errors.push(`Row ${fileRow}: Class "${className}" does not exist. Available classes:${available}`);
          return;
        }

        const gender = normalizeEnum(get('Gender'), GENDERS, 'Male');
        const religion = normalizeEnum(get('Religion'), RELIGIONS, 'Christian');
        // Blank Term in the CSV defaults to the school's CURRENT term so the
        // imported student is auto-charged the current term's class fee.
        const term = normalizeEnum(get('Term'), TERMS, settings?.current_term || 'First');
        const status = normalizeEnum(get('Status'), STUDENT_STATUSES, 'admitted');
        const dob = normalizeDateCell(get('Date of Birth'), 'Date of Birth');
        const admissionDate = normalizeDateCell(get('Admission Date'), 'Admission Date');
        const enumError = [gender, religion, term, status, dob, admissionDate].find((r) => r.error);
        if (enumError) {
          errors.push(`Row ${fileRow}: ${enumError.error}`);
          return;
        }

        const parentName = get('Parent Name').trim();
        const parentContact = get('Parent Contact').trim();
        if (!parentName || !parentContact) {
          errors.push(`Row ${fileRow}: Parent name and contact are required for ${first} ${last}.`);
          return;
        }

        const row = {
          fileRow,
          first_name: first,
          middle_name: get('Middle Name').trim() || null,
          last_name: last,
          class_applying: canonicalClass,
          term: term.value,
          gender: gender.value,
          religion: religion.value,
          date_of_birth: dob.value,
          parent_name: parentName,
          parent_contact: parentContact,
          home_town: get('Home Town').trim() || null,
          place_of_stay: get('Place of Stay').trim() || null,
          teacher: get('Teacher').trim() || null,
          previous_school: get('Previous School').trim() || null,
          admission_date: admissionDate.value,
          status: status.value,
          portal_confirmed: PORTAL_YES.has(String(get('Portal Confirmed')).trim().toLowerCase()),
        };

        // Prevent duplication BEFORE anything is written: a provided student ID
        // or the natural key (same name & date of birth) that already exists in
        // the app makes this row a duplicate of an existing student.
        const providedId = get('Student ID').trim();
        let duplicateStatus = statusById.get(providedId) || null;
        if (!duplicateStatus && dob.value) {
          const key = `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${String(dob.value).slice(0, 10)}`;
          duplicateStatus = existingKeys.get(key) || null;
        }
        if (duplicateStatus) {
          duplicates.push({ fileRow, name: `${first} ${last}`, status: duplicateStatus });
          return; // skip this row — student is already in the app
        }

        if (providedId) {
          providedRows.push({ ...row, student_id: providedId });
        } else {
          autoRows.push(row);
        }
      });

      const validRowCount = providedRows.length + autoRows.length;

      // ---- Duplicate guard BEFORE any writes ---------------------------------
      // Rows matching students who are ALREADY ADMITTED are surfaced to the
      // admin first; importing the rest is only accepted after confirmation.
      const admittedMatches = duplicates.filter((d) => d.status === 'admitted');
      if (admittedMatches.length > 0) {
        const listPreview = admittedMatches
          .slice(0, 8)
          .map((d) => `• Row ${d.fileRow}: ${d.name} (already admitted)`)
          .join('\n');
        const moreNote = admittedMatches.length > 8 ? `\n…and ${admittedMatches.length - 8} more.` : '';
        const promptMessage =
          `${admittedMatches.length} row(s) in "${file.name}" match students who are ` +
          `already admitted to this school (same name & date of birth or student ID):\n\n` +
          `${listPreview}${moreNote}\n\n` +
          `These duplicate rows will be skipped. ${validRowCount > 0 ? `Import the remaining ${validRowCount} valid student(s) anyway?` : 'There are no other valid rows to import.'}`;
        const proceed = window.confirm(promptMessage);
        if (!proceed) {
          toast.info('CSV import cancelled', 'No students were imported because the file matched already-admitted students. No changes were made.');
          setImporting(false);
          return;
        }
        // Admin accepted the risk — record the skipped duplicates as warnings.
        duplicates.forEach((d) => {
          errors.push(`Row ${d.fileRow} (${d.name}): ${d.status === 'admitted' ? 'already admitted' : 'already in the app'} — skipped.`);
        });
      } else if (duplicates.length > 0) {
        // No already-admitted matches, but pending/no-status duplicates exist:
        // skip them with a warning (no prompt required).
        duplicates.forEach((d) => {
          errors.push(`Row ${d.fileRow} (${d.name}): looks like a duplicate of an existing student — skipped.`);
        });
      }

      if (validRowCount === 0) {
        const preview = errors.slice(0, 10).join('\n');
        toast.error(
          'No students imported',
          `No rows from "${file.name}" could be imported.\n${preview}${errors.length > 10 ? `\n...and ${errors.length - 10} more.` : ''}`
        );
        load();
        setImporting(false);
        return;
      }

      // Generate IDs for rows that did not provide one (bounded concurrency).
      const generatedIds = await mapWithConcurrency(autoRows, 6, async () => {
        const { data: generatedId, error } = await supabase.rpc('generate_student_id');
        if (error || !generatedId) throw new Error('Could not generate a student ID: ' + (error?.message || 'unknown'));
        return generatedId;
      });
      generatedIds.forEach((id, i) => {
        autoRows[i].student_id = id;
      });

      // Final duplicate pass (in-file duplicates + collisions with existing IDs).
      const seen = new Set();
      const insertRows = [];
      for (const r of [...providedRows, ...autoRows]) {
        if (seen.has(r.student_id) || idSet.has(r.student_id)) {
          errors.push(`Row ${r.fileRow} (${r.first_name} ${r.last_name}): Student ID "${r.student_id}" already exists.`);
          continue;
        }
        seen.add(r.student_id);
        insertRows.push(r);
      }
if (insertRows.length) {
        for (let i = 0; i < insertRows.length; i += 100) {
          const chunk = insertRows.slice(i, i + 100).map((r) => ({
            student_id: r.student_id,
            first_name: r.first_name,
            middle_name: r.middle_name,
            last_name: r.last_name,
            class_applying: r.class_applying,
            term: r.term,
            gender: r.gender,
            religion: r.religion,
            date_of_birth: r.date_of_birth,
            parent_name: r.parent_name,
            parent_contact: r.parent_contact,
            home_town: r.home_town,
            place_of_stay: r.place_of_stay,
            teacher: r.teacher,
            previous_school: r.previous_school,
            admission_date: r.admission_date,
            status: r.status,
            portal_confirmed: r.portal_confirmed,
            sub_admin_approved: r.portal_confirmed,
            school_id: schoolId,
          }));
          const { error: insertError } = await supabase.from('applications').insert(chunk);
          if (insertError) throw new Error('Bulk insert failed: ' + insertError.message);
        }

        // Create fee records for every imported student using the school's current
        // fee structure for their class + term (auto-applied exactly like the
        // Admit Student form), with an itemized breakdown snapshot so receipts
        // and fee records stay consistent.
        const feeRows = insertRows.map((r) => {
          const fee = feeMap.get(`${r.class_applying.trim().toLowerCase()}|||${r.term}`) || {
            amount: 0,
            academic_year: defaultAcademicYear,
          };
          const totalAmount = Number(fee.amount) || 0;
          const feeYear = fee.academic_year || defaultAcademicYear;
          return {
            student_id: r.student_id,
            academic_year: feeYear,
            term: r.term,
            total_amount: totalAmount,
            amount_paid: 0,
            debt: 0,
            payment_status: totalAmount > 0 ? 'unpaid' : 'paid',
            last_payment_date: null,
            school_id: schoolId,
            fee_breakdown: {
              class_fee: totalAmount,
              items: [],
              academic_year: feeYear,
              term: r.term,
              generated_at: new Date().toISOString(),
            },
          };
        });
        for (let i = 0; i < feeRows.length; i += 100) {
          const chunk = feeRows.slice(i, i + 100);
          const { error: feeError } = await supabase.from('fees').upsert(chunk, { onConflict: 'student_id,academic_year,term' });
          if (feeError) throw new Error('Fee record creation failed: ' + feeError.message);
        }
      }

      const summary = `Imported ${insertRows.length} student(s) from "${file.name}".`;
      if (errors.length) {
        const preview = errors.slice(0, 8).join('\n');
        toast.error(
          'CSV import finished with issues',
          `${summary} ${errors.length} row(s) skipped:\n${preview}${errors.length > 8 ? `\n...and ${errors.length - 8} more.` : ''}`
        );
      } else {
        toast.success('Students imported', summary);
      }
      load();
    } catch (err) {
      toast.error('Could not import CSV', err.message);
      console.error('Import CSV error:', err);
    } finally {
      setImporting(false);
    }
  };

  const photoToDataUrl = async (url, maxSize = 160) => {
    if (!url) return null;
    try {
      const res = await fetch(photoUrl(url), { mode: 'cors' });
      if (!res || !res.ok) return null;
      const blob = await res.blob();
      if (!blob || !blob.size) return null;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise((resolve, reject) => {
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image load failed'));
          img.src = objectUrl;
        });
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
      } finally {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (err) {
          // noop
        }
      }
    } catch (err) {
      return null;
    }
  };
const printClassList = async () => {
    if (!filtered.length) {
      toast.error('No students to print', 'Try adjusting the filters first.');
      return;
    }
    const schoolName = settings?.school_name || 'My School';
    // Convert photos to data URLs in small batches so one slow/broken image
    // cannot break the whole document and we don't hammer the storage server.
    const photoUrls = new Array(filtered.length).fill(null);
    for (let start = 0; start < filtered.length; start += 6) {
      const batch = filtered.slice(start, start + 6);
      const converted = await Promise.all(batch.map((s) => photoToDataUrl(s.student_photo_url, 160)));
      converted.forEach((url, k) => {
        photoUrls[start + k] = url;
      });
    }

    const rows = filtered
      .map((s, idx) => {
        const name = buildStudentName(s.first_name, s.middle_name, s.last_name);
        const photoHtml = photoUrls[idx]
          ? `<img src="${photoUrls[idx]}" style="width:44px;height:44px;object-fit:cover;border-radius:50%;border:1px solid #e2e8f0;" alt="" />`
          : '';
        return `<tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${photoHtml}</td>
          <td><strong>${escapeHtml(s.student_id)}</strong></td>
          <td>${escapeHtml(name)}</td>
          <td>${formatDate(s.date_of_birth)}</td>
          <td>${escapeHtml(s.parent_contact || '-')}</td>
        </tr>`;
      })
      .join('');

    const classText = classFilter || 'All Classes';
    const genderText = genderFilter || 'All Genders';

    openPrintWindow(
      `Class List - ${schoolName}`,
      `<div style="text-align:center;">
         <h1>${escapeHtml(schoolName)}</h1>
         <h2>Class List &mdash; ${escapeHtml(classText)}</h2>
         <p class="meta">Gender: ${escapeHtml(genderText)} &nbsp;|&nbsp; Total Students: ${filtered.length} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p>
       </div>
       <table>
         <thead>
           <tr><th style="width:40px;text-align:center;">#</th><th style="width:60px;">Photo</th><th>Student ID</th><th>Name</th><th>Date of Birth</th><th>Parent Contact</th></tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>
       <p class="meta" style="text-align:center;margin-top:18px;">${escapeHtml(schoolName)} &copy; ${new Date().getFullYear()}</p>`
    );
  };

  const printProfile = (student) => {
    if (!student) return;
    const name = buildStudentName(student.first_name, student.middle_name, student.last_name);
    const field = (label, value) =>
      `<tr><td style="padding:6px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:200px;">${escapeHtml(label)}</td><td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(value) || '-'}</td></tr>`;
    openPrintWindow(
      `${name} - Student Profile`,
      `<div style="text-align:center;">
         <h1>${escapeHtml(name)}</h1>
         <p class="meta">${escapeHtml(student.student_id)}</p>
         ${
           student.student_photo_url
             ? `<div style="text-align:center;margin:12px 0;"><img src="${photoUrl(student.student_photo_url)}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #6366f1;" alt="" /></div>`
             : ''
         }
       </div>
       <table>
         ${field('Full Name', name)}
         ${field('Gender', student.gender)}
         ${field('Date of Birth', formatDate(student.date_of_birth))}
         ${field('Religion', student.religion)}
         ${field('Home Town', student.home_town)}
         ${field('Place of Stay', student.place_of_stay)}
         ${field('Student ID', student.student_id)}
         ${field('Class', student.class_applying)}
         ${field('Term', termLabel(student.term))}
         ${field('Teacher', student.teacher)}
         ${field('Previous School', student.previous_school)}
         ${field('Admission Date', formatDate(student.admission_date))}
         ${field('Application Date', formatDateTime(student.created_at))}
         ${field('Parent / Guardian', student.parent_name)}
         ${field('Parent Contact', student.parent_contact)}
         ${field('Admission Status', student.status)}
         ${field('Portal Confirmed', student.portal_confirmed ? 'Yes' : 'No')}
       </table>`
    );
  };

  // Generate the printable Student Admission Form (with fee details) for ANY
  // student on record — manually admitted or imported via CSV. Fee details come
  // from the student's saved fee record (fee_breakdown) for the current
  // academic year + term; if none exists yet it falls back to the current
  // class-fee structure so the form always shows the fees.
  const printAdmissionForm = async (student) => {
    if (!student || !schoolId) return;
    const defaultAcademicYear = settings?.academic_year || currentAcademicYear();
    const term = student.term || settings?.current_term || 'First';

    let classFee = 0;
    let items = [];
    let totalAmount = 0;
    let feeYear = defaultAcademicYear;

    try {
      // Look up the student's saved fee record. Prefer the row for the student's
      // term + the current academic year; fall back to any fee row for the same
      // term (covers students admitted under a different academic year).
      const { data: feeRows } = await supabase
        .from('fees')
        .select('*')
        .eq('student_id', student.student_id)
        .order('created_at', { ascending: false });
      const fee =
        (feeRows || []).find((r) => r.term === term && r.academic_year === defaultAcademicYear) ||
        (feeRows || []).find((r) => r.term === term);

      if (fee) {
        const breakdown = fee.fee_breakdown || {};
        classFee = Number(breakdown.class_fee) || Number(fee.total_amount) || 0;
        items = Array.isArray(breakdown.items) ? breakdown.items : [];
        totalAmount = Number(fee.total_amount) || classFee;
        feeYear = breakdown.academic_year || fee.academic_year || defaultAcademicYear;
      } else {
        const resolved = await resolveClassFee(student.class_applying, term);
        classFee = resolved.amount;
        feeYear = resolved.year || defaultAcademicYear;
        totalAmount = classFee;
        items = [];
      }
    } catch (err) {
      console.warn('Failed to load fee details for admission form:', err.message);
    }

    const studentName = buildStudentName(student.first_name, student.middle_name, student.last_name);
    openAdmissionForm(
      {
        studentId: student.student_id,
        student,
        schoolName: settings?.school_name || 'My School',
        schoolLogoUrl: settings?.logo_url || '',
        academicYear: feeYear,
        term,
        classFee,
        items,
        totalAmount,
        includeFees: true,
      },
      `Admission Form - ${studentName}`
    );
  };

return (
    <div>
      <PageHeader
        title="Students"
        subtitle={`${students.length} students currently on record.`}
        icon={Users}
        actions={
          <Button onClick={openAdmitModal}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Admit student
          </Button>
        }
      />

      <div className="mb-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name, ID or contact..." className="lg:col-span-2" />
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
            <option value="">All genders</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={printClassList}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print class list
          </Button>
          <Button variant="secondary" onClick={openPromote}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            Promote students
          </Button>
          <Button variant="secondary" onClick={exportCSV}>
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download className="h-4 w-4" aria-hidden="true" />
            CSV template
          </Button>
          <Button variant="secondary" onClick={() => importInputRef.current?.click()} loading={importing}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Import CSV
          </Button>
        </div>
      </div>
      <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCSV} />

      {loading ? (
        <Spinner label="Loading students..." />
      ) : filtered.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-center gap-3">
                {s.student_photo_url ? (
                  <img src={photoUrl(s.student_photo_url)} alt="Student" className="h-14 w-12 rounded-xl object-cover ring-2 ring-brand-100" />
                ) : (
                  <span className="flex h-14 w-12 items-center justify-center rounded-xl bg-brand-50 text-lg font-extrabold text-brand-600">
                    {(s.first_name || 'S').charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                  </p>
                  <p className="font-mono text-xs text-slate-400">{s.student_id}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="blue">{s.class_applying}</Badge>
                    <Badge tone={s.status === 'admitted' ? 'green' : 'amber'}>{s.status}</Badge>
                    <Badge tone={s.portal_confirmed ? 'teal' : 'slate'}>{s.portal_confirmed ? 'Portal' : 'Pending'}</Badge>
                  </div>
                </div>
              </div>
<div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-50 pt-3">
                <p className="min-w-0 flex-1 truncate text-xs text-slate-400">Joined {formatDate(s.created_at)}</p>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => setViewing(s)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600" aria-label="View details" title="View profile">
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => openEdit(s)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600" aria-label="Edit student" title="Edit student">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => printAdmissionForm(s)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                    aria-label="Print admission form"
                    title="Print admission form"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {!s.portal_confirmed ? (
                    <button
                      type="button"
                      onClick={() => confirmPortal(s)}
                      disabled={portalBusy === s.student_id}
                      className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600"
                      aria-label="Confirm portal"
                      title="Confirm portal"
                    >
                      {portalBusy === s.student_id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setDeleting(s)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600" aria-label="Delete student" title="Delete student">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title="No students found"
          message={students.length ? 'Try adjusting your search or filters.' : 'Admit your first student to get started.'}
          action={students.length ? null : <Button onClick={openAdmitModal}>Admit student</Button>}
        />
      )}
<Modal open={admitOpen} onClose={() => setAdmitOpen(false)} title="Admit a new student" size="lg" footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Button variant="secondary" onClick={() => setAdmitOpen(false)}>
            Cancel
          </Button>
          <Button onClick={admitStudent} loading={busy}>
            Admit student
          </Button>
        </div>
      }>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="First name *" value={form.first_name} onChange={set('first_name')} />
          <Input label="Middle name" value={form.middle_name} onChange={set('middle_name')} />
          <Input label="Last name *" value={form.last_name} onChange={set('last_name')} />
          <Select label="Class *" value={form.class_applying} onChange={set('class_applying')}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Term" value={form.term} onChange={set('term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
              Term fees ({form.term} Term)
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Class (term) fee (GHC)"
                type="number"
                min="0"
                step="0.01"
                value={classFeeAmount}
                onChange={(e) => setClassFeeAmount(Number(e.target.value) || 0)}
              />
              {admissionItems.map((it) => (
                <Input
                  key={it.id}
                  label={`${it.name} (GHC)`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemAmounts[it.id] ?? 0}
                  onChange={(e) => setItemAmounts((m) => ({ ...m, [it.id]: Number(e.target.value) || 0 }))}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {admissionItems.length === 0
                ? 'No additional admission items configured. Add some under Settings → Admission Items.'
                : 'Enter the amount charged to this student for each additional item. Defaults come from Settings.'}
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
              <span className="text-sm font-semibold text-slate-600">Total term fee</span>
              <span className="text-lg font-extrabold text-brand-700">GHC {formatCurrency(admittedTotalFee)}</span>
            </div>
          </div>
          <Input label="Date of birth *" type="date" value={form.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().split('T')[0]} />
          <Input label="Admission date" type="date" value={form.admission_date} onChange={set('admission_date')} max={new Date().toISOString().split('T')[0]} />
          <Select label="Gender" value={form.gender} onChange={set('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select label="Religion" value={form.religion} onChange={set('religion')}>
            {RELIGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Input label="Parent / guardian name *" value={form.parent_name} onChange={set('parent_name')} />
          <Input label="Parent / guardian contact *" type="tel" value={form.parent_contact} onChange={set('parent_contact')} />
          <Input label="Home town" value={form.home_town} onChange={set('home_town')} />
          <Input label="Place of stay" value={form.place_of_stay} onChange={set('place_of_stay')} />
          <Input label="Previous school" value={form.previous_school} onChange={set('previous_school')} className="sm:col-span-2" />
        </div>
        <div className="mt-5 flex flex-col items-center gap-2 border-t border-slate-100 pt-5">
          <PhotoUpload value={photoFile} onChange={setPhotoFile} maxMb={1} circle />
          {formError ? <Alert tone="error" className="w-full">{formError}</Alert> : null}
        </div>
      </Modal>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title="Student details"
        size="lg"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            {viewing ? (
              <>
                <Button variant="secondary" onClick={() => printAdmissionForm(viewing)}>
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Admission form
                </Button>
                <Button variant="secondary" onClick={() => printProfile(viewing)}>
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  Print profile
                </Button>
              </>
            ) : null}
            <Button variant="secondary" onClick={() => setViewing(null)}>
              Close
            </Button>
          </div>
        }
      >
        {viewing ? (
          <div>
            <div className="flex items-center gap-4">
              {viewing.student_photo_url ? (
                <img src={photoUrl(viewing.student_photo_url)} alt="Student" className="h-20 w-16 rounded-2xl object-cover ring-2 ring-brand-100" />
              ) : (
                <span className="flex h-20 w-16 items-center justify-center rounded-2xl bg-brand-50 text-2xl font-extrabold text-brand-600">
                  {(viewing.first_name || 'S').charAt(0)}
                </span>
              )}
              <div>
                <p className="text-base font-bold text-slate-900">
                  {buildStudentName(viewing.first_name, viewing.middle_name, viewing.last_name)}
                </p>
                <p className="font-mono text-xs text-slate-400">{viewing.student_id}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Badge tone="blue">{viewing.class_applying}</Badge>
                  <Badge tone={viewing.status === 'admitted' ? 'green' : 'amber'}>{viewing.status}</Badge>
                  <Badge tone={viewing.portal_confirmed ? 'teal' : 'slate'}>{viewing.portal_confirmed ? 'Portal confirmed' : 'Portal pending'}</Badge>
                </div>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Detail label="Gender" value={viewing.gender} />
              <Detail label="Date of birth" value={formatDate(viewing.date_of_birth)} />
              <Detail label="Religion" value={viewing.religion} />
              <Detail label="Home town" value={viewing.home_town} />
              <Detail label="Place of stay" value={viewing.place_of_stay} />
              <Detail label="Term" value={termLabel(viewing.term)} />
              <Detail label="Teacher" value={viewing.teacher} />
              <Detail label="Previous school" value={viewing.previous_school} />
              <Detail label="Admission date" value={formatDate(viewing.admission_date)} />
              <Detail label="Applied" value={formatDateTime(viewing.created_at)} />
              <Detail label="Parent / guardian" value={viewing.parent_name} />
              <Detail label="Parent contact" value={viewing.parent_contact} />
            </dl>
          </div>
        ) : null}
      </Modal>
<Modal
        open={!!editing}
        onClose={closeEdit}
        title={editing ? `Edit student \u2014 ${buildStudentName(editing.first_name, editing.middle_name, editing.last_name)}` : 'Edit student'}
        size="lg"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button variant="secondary" onClick={closeEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} loading={editBusy}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Save changes
            </Button>
          </div>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="First name *" value={editForm.first_name || ''} onChange={setEdit('first_name')} />
          <Input label="Middle name" value={editForm.middle_name || ''} onChange={setEdit('middle_name')} />
          <Input label="Last name *" value={editForm.last_name || ''} onChange={setEdit('last_name')} />
          <Select label="Class *" value={editForm.class_applying || ''} onChange={setEdit('class_applying')}>
            <option value="">Select class...</option>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Term" value={editForm.term || 'First'} onChange={setEdit('term')}>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input label="Date of birth *" type="date" value={editForm.date_of_birth || ''} onChange={setEdit('date_of_birth')} />
          <Select label="Gender" value={editForm.gender || 'Male'} onChange={setEdit('gender')}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
          <Select label="Religion" value={editForm.religion || 'Christian'} onChange={setEdit('religion')}>
            {RELIGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Input label="Parent / guardian name *" value={editForm.parent_name || ''} onChange={setEdit('parent_name')} />
          <Input label="Parent / guardian contact *" type="tel" value={editForm.parent_contact || ''} onChange={setEdit('parent_contact')} />
          <Input label="Home town" value={editForm.home_town || ''} onChange={setEdit('home_town')} />
          <Input label="Place of stay" value={editForm.place_of_stay || ''} onChange={setEdit('place_of_stay')} />
          <Input label="Previous school" value={editForm.previous_school || ''} onChange={setEdit('previous_school')} />
          <Input label="Teacher (class teacher)" value={editForm.teacher || ''} onChange={setEdit('teacher')} />
          <Input label="Admission date" type="date" value={editForm.admission_date || ''} onChange={setEdit('admission_date')} />
          <Select label="Admission status" value={editForm.status || 'admitted'} onChange={setEdit('status')}>
            <option value="pending">Pending</option>
            <option value="admitted">Admitted</option>
          </Select>
        </div>
        <div className="mt-5 flex flex-col items-center gap-2 border-t border-slate-100 pt-5">
          <PhotoUpload
            value={editPhotoFile || (editPhotoRemoved || !editing?.student_photo_url ? null : photoUrl(editing.student_photo_url))}
            onChange={(v) => {
              setEditPhotoFile(v instanceof File ? v : null);
              if (!v) setEditPhotoRemoved(!!editing?.student_photo_url);
              else setEditPhotoRemoved(false);
            }}
            maxMb={1}
            circle
          />
          {editError ? <Alert tone="error" className="w-full">{editError}</Alert> : null}
        </div>
      </Modal>
<Modal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        title="Promote students"
        size="lg"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button variant="secondary" onClick={() => setPromoteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitPromote} loading={promoteBusy}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
              Promote selected
            </Button>
          </div>
        }
      >
        <Alert tone="info" className="mb-4">
          Students matching the current search / class / gender filters are listed below. Existing fee balances are preserved.
        </Alert>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">
            {filtered.length} student(s) shown · <strong className="text-slate-700">{promoteSelected.size}</strong> selected
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={filtered.length > 0 && promoteSelected.size === filtered.length}
              onChange={(e) => toggleAllPromote(e.target.checked)}
            />
            Select all
          </label>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100">
          {filtered.length ? (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Select</th>
                  <th className="px-3 py-2">Student ID</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Gender</th>
                  <th className="px-3 py-2">Current class</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className={promoteSelected.has(s.student_id) ? 'bg-brand-50/40' : ''}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={promoteSelected.has(s.student_id)}
                        onChange={() => toggleStudent(s.student_id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{s.student_id}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">
                      {buildStudentName(s.first_name, s.middle_name, s.last_name)}
                    </td>
                    <td className="px-3 py-2">{s.gender || 'Male'}</td>
                    <td className="px-3 py-2">{s.class_applying}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              No students match the current filters.
            </div>
          )}
        </div>

        <div className="mt-4">
          <Select label="Promote to *" value={promoteTarget} onChange={(e) => setPromoteTarget(e.target.value)}>
            <option value="">Select class...</option>
            {promoteTargetOptions.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteBusy}
        title="Delete student?"
        message={`This permanently removes ${deleting ? buildStudentName(deleting.first_name, deleting.middle_name, deleting.last_name) : 'this student'} together with their fees, attendance and results. This cannot be undone.`}
        confirmLabel="Delete student"
      />
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-700">{value || '-'}</dd>
    </div>
  );
}