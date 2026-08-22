/**
 * Backup & Restore Module — Comprehensive Database Backup
 * Exports and imports ALL school data as JSON files.
 * Preserves UUID IDs to maintain foreign key relationships.
 * Available to admins (sub_admin/admin) and super admin.
 * 
 * The backup file contains:
 *  - All data tables with their full records (including IDs)
 *  - A schema snapshot for reference
 *  - Metadata about the backup
 * 
 * Restore process:
 *  1. Deletes existing data in reverse dependency order
 *  2. Re-inserts records in forward dependency order
 *  3. Preserves original IDs so foreign keys remain valid
 */

import { getEl, showMessage, clearMessage, setLoading, getCurrentSchoolId } from './utils.js';

let supabaseClient = null;

export function initBackupRestore(supabase) {
  supabaseClient = supabase;
}

export function setupBackupRestore() {
  getEl('btnBackupData')?.addEventListener('click', handleBackup);
  getEl('backupFileInput')?.addEventListener('change', handleFileSelect);
  getEl('btnConfirmRestore')?.addEventListener('click', confirmRestore);
  getEl('btnDownloadSchema')?.addEventListener('click', downloadSchemaReference);
}

// ================================================================
// ALL TABLES in dependency order (parents first, children last)
// ================================================================

const BACKUP_TABLES = [
  // Level 0: System-level tables (no school_id, or global)
  { name: 'modules', label: 'System Modules', system: true },
  
  // Level 1: Core entities (no dependencies on other data tables)
  { name: 'schools', label: 'Schools', system: true },
  { name: 'profiles', label: 'User Profiles', system: true },
  
  // Level 2: School-scoped entities (depend on schools)
  { name: 'school_settings', label: 'School Settings', schoolScoped: true },
  { name: 'settings', label: 'Legacy Settings', schoolScoped: true },
  { name: 'sub_admins', label: 'Sub Admins', schoolScoped: true },
  { name: 'classes', label: 'Classes', schoolScoped: true },
  { name: 'subjects', label: 'Subjects', schoolScoped: true },
  { name: 'grading_systems', label: 'Grading Systems', schoolScoped: true },
  
  // Level 3: Entities that reference schools + classes/subjects
  { name: 'applications', label: 'Students', schoolScoped: true },
  { name: 'teachers', label: 'Teachers', schoolScoped: true },
  { name: 'accountants', label: 'Accountants', schoolScoped: true },
  { name: 'announcements', label: 'Announcements', schoolScoped: true },
  { name: 'fee_categories', label: 'Fee Categories', schoolScoped: true },
  { name: 'class_fees', label: 'Class Fees', schoolScoped: true },
  
  // Level 4: Entities that reference applications/teachers
  { name: 'parent_links', label: 'Parent Links', schoolScoped: true },
  { name: 'teacher_classes_subjects', label: 'Teacher Class-Subjects', schoolScoped: true },
  { name: 'teacher_documents', label: 'Teacher Documents', schoolScoped: true },
  { name: 'sub_admin_modules', label: 'Sub Admin Modules', schoolScoped: true },
  { name: 'school_modules', label: 'School Module Locks', schoolScoped: true },
  
  // Level 5: Exam entities (reference applications)
  { name: 'exams', label: 'Exams', schoolScoped: true },
  { name: 'exam_subjects', label: 'Exam Subjects', schoolScoped: true },
  { name: 'exam_results', label: 'Exam Results', schoolScoped: true },
  { name: 'exam_student_details', label: 'Exam Student Details', schoolScoped: true },
  
  // Level 6: Attendance (references applications)
  { name: 'attendance', label: 'Attendance', schoolScoped: true },
  
  // Level 7: Fees entities (reference applications, classes)
  { name: 'fees', label: 'Student Fees', schoolScoped: true },
  { name: 'payment_transactions', label: 'Payment Transactions', schoolScoped: true },
  { name: 'receipts', label: 'Receipts', schoolScoped: true },
  
  // Level 8: Activity logs (reference sub_admins)
  { name: 'sub_admin_activities', label: 'Sub Admin Activities', schoolScoped: true },
];

// Tables that should NOT have school_id filter (system-level)
const SYSTEM_TABLES = ['modules', 'schools', 'profiles'];

// Tables where school_id is NOT a column (need special handling)
const NO_SCHOOL_ID_TABLES = ['modules', 'profiles', 'exam_subjects', 'exam_student_details', 'sub_admin_activities', 'sub_admin_modules'];

// Tables that do NOT have a created_at column (can't order by it)
const NO_CREATED_AT_TABLES = ['modules', 'sub_admin_modules', 'school_modules', 'grading_systems', 'teacher_classes_subjects', 'teacher_documents', 'school_settings', 'settings'];

// Tables that use a non-UUID primary key
const TEXT_PK_TABLES = ['settings']; // settings.id is TEXT

// Tables that have a composite/unique key that must be preserved
const UNIQUE_KEY_TABLES = ['school_settings']; // school_id is the PK

// ================================================================
// BACKUP
// ================================================================

async function handleBackup() {
  const btn = getEl('btnBackupData');
  setLoading(btn, true, 'Backing up...');
  clearMessage('backupMessage');

  try {
    const schoolId = await getCurrentSchoolId();
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data: profile } = await supabaseClient.from('profiles')
      .select('role, school_id')
      .eq('id', user.id)
      .single();

    const isSuperAdmin = profile?.role === 'super_admin';

    const backup = {
      version: '2.0',
      created_at: new Date().toISOString(),
      school_id: isSuperAdmin ? null : schoolId,
      school_name: '',
      schema_version: '2.0',
      data: {},
      table_count: BACKUP_TABLES.length,
    };

    // Get school name
    if (schoolId) {
      const { data: school } = await supabaseClient.from('schools')
        .select('name, registration_id')
        .eq('id', schoolId)
        .single();
      if (school) backup.school_name = `${school.name} (${school.registration_id})`;
    } else if (isSuperAdmin) {
      backup.school_name = 'All Schools (Super Admin)';
    }

    // Backup each table
    for (const table of BACKUP_TABLES) {
      try {
        let query = supabaseClient.from(table.name).select('*');

        // Apply school_id filter for school-scoped tables
        if (!isSuperAdmin && !SYSTEM_TABLES.includes(table.name) && schoolId) {
          if (table.schoolScoped) {
            if (table.name === 'sub_admin_modules' || table.name === 'sub_admin_activities') {
              // These tables reference sub_admins, not school_id directly.
              // Fetch sub_admin ids for this school, then filter by those.
              const { data: subAdmins } = await supabaseClient
                .from('sub_admins')
                .select('id')
                .eq('school_id', schoolId);
              const subAdminIds = (subAdmins || []).map(sa => sa.id);
              if (subAdminIds.length > 0) {
                query = query.in('sub_admin_id', subAdminIds);
              } else {
                // No sub_admins for this school - nothing to backup
                backup.data[table.name] = [];
                continue;
              }
            } else if (table.name === 'exam_subjects' || table.name === 'exam_student_details') {
              // These tables reference exams, not school_id directly.
              // Fetch exam ids for this school, then filter by those.
              const { data: exams } = await supabaseClient
                .from('exams')
                .select('id')
                .eq('school_id', schoolId);
              const examIds = (exams || []).map(e => e.id);
              if (examIds.length > 0) {
                query = query.in('exam_id', examIds);
              } else {
                // No exams for this school - nothing to backup
                backup.data[table.name] = [];
                continue;
              }
            } else if (!NO_SCHOOL_ID_TABLES.includes(table.name)) {
              query = query.eq('school_id', schoolId);
            }
          }
        }

        // NOTE: No ordering is applied because different tables have different
        // available columns (some have created_at, some have id, some use
        // composite keys). Ordering doesn't affect backup correctness.
        const { data, error } = await query;

        if (error) {
          console.warn(`Skipping table ${table.name}: ${error.message}`);
          backup.data[table.name] = [];
        } else {
          backup.data[table.name] = data || [];
        }
      } catch (err) {
        console.warn(`Error backing up table ${table.name}: ${err.message}`);
        backup.data[table.name] = [];
      }
    }

    // Generate filename
    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    const schoolIdStr = schoolId ? schoolId.substring(0, 8) : 'SYSTEM';
    const filename = `backup_${schoolIdStr}_${dateStr}_${timeStr}.json`;

    // Download as JSON file
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Count total records
    const totalRecords = Object.values(backup.data).reduce((sum, arr) => sum + arr.length, 0);
    const tablesWithData = Object.entries(backup.data).filter(([, arr]) => arr.length > 0).length;
    showMessage('backupMessage', 
      `✅ Backup complete! ${totalRecords} records exported from ${tablesWithData} tables.`, 'success');
  } catch (err) {
    showMessage('backupMessage', 'Error during backup: ' + err.message, 'error');
    console.error('Backup error:', err);
  } finally {
    setLoading(btn, false, '📥 Backup Data');
  }
}

// ================================================================
// SCHEMA REFERENCE DOWNLOAD
// ================================================================

function downloadSchemaReference() {
  const schemaInfo = {
    version: '2.0',
    description: 'Database schema reference for the Student Admission Portal',
    generated_at: new Date().toISOString(),
    tables: BACKUP_TABLES.map(t => ({
      name: t.name,
      label: t.label,
      type: t.system ? 'system' : (t.schoolScoped ? 'school-scoped' : 'standard'),
    })),
    restore_order: [...BACKUP_TABLES].map(t => t.name),
    notes: [
      'This file is for reference only. Use the backup file for actual data restoration.',
      'Restore order: parents first, children last (forward dependency order).',
      'IDs are preserved during restore to maintain foreign key relationships.',
      'After re-running the schema from scratch, restore this backup to get back to a perfect state.',
    ],
  };

  const blob = new Blob([JSON.stringify(schemaInfo, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `schema_reference_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showMessage('backupMessage', '📄 Schema reference downloaded. This shows the table structure and restore order.', 'success');
}

// ================================================================
// RESTORE
// ================================================================

let pendingRestoreData = null;

function handleFileSelect(e) {
  clearMessage('backupMessage');
  const file = e.target.files[0];
  if (!file) {
    getEl('restorePreview').style.display = 'none';
    pendingRestoreData = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      
      // Validate format
      if (!data.version || !data.data || typeof data.data !== 'object') {
        showMessage('backupMessage', '❌ Invalid backup file format.', 'error');
        getEl('restorePreview').style.display = 'none';
        pendingRestoreData = null;
        return;
      }

      pendingRestoreData = data;
      showRestorePreview(data);
    } catch (err) {
      showMessage('backupMessage', '❌ Could not parse backup file: ' + err.message, 'error');
      getEl('restorePreview').style.display = 'none';
      pendingRestoreData = null;
    }
  };
  reader.readAsText(file);
}

function showRestorePreview(data) {
  const container = getEl('restorePreview');
  const body = getEl('restorePreviewBody');
  container.style.display = 'block';

  // Summary
  getEl('restoreFileInfo').textContent = 
    `Backup created: ${new Date(data.created_at).toLocaleString()} | School: ${data.school_name || 'Unknown'} | Version: ${data.version || '1.0'}`;

  // Table preview
  let totalRecords = 0;
  let html = '';
  for (const table of BACKUP_TABLES) {
    const records = data.data[table.name] || [];
    totalRecords += records.length;
    if (records.length > 0) {
      html += `<tr>
        <td>${table.name}</td>
        <td>${table.label}</td>
        <td>${records.length}</td>
        <td>${records.length > 0 ? '✅ Will restore' : '—'}</td>
      </tr>`;
    }
  }

  if (html) {
    body.innerHTML = html;
  } else {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:1rem;">No records found in backup file.</td></tr>';
  }

  getEl('restoreTotalRecords').textContent = totalRecords;
  getEl('btnConfirmRestore').disabled = totalRecords === 0;
}

/**
 * Restore data with ID preservation.
 * 
 * Strategy:
 * 1. Delete existing data in REVERSE dependency order (children first)
 * 2. Insert backup data in FORWARD dependency order (parents first)
 * 3. Preserve original IDs so foreign key relationships remain intact
 * 4. Use upsert to handle any conflicts gracefully
 */
async function confirmRestore() {
  if (!pendingRestoreData) {
    showMessage('backupMessage', '❌ No backup data loaded.', 'error');
    return;
  }

  if (!confirm('⚠️ WARNING: This will DELETE all existing data for the tables shown and REPLACE it with backup data. This cannot be undone! Are you sure?')) {
    return;
  }

  if (!confirm('⚠️ FINAL CONFIRMATION: Are you ABSOLUTELY sure you want to restore this backup? All current data will be lost.')) {
    return;
  }

  const btn = getEl('btnConfirmRestore');
  setLoading(btn, true, 'Restoring...');
  clearMessage('backupMessage');

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { data: profile } = await supabaseClient.from('profiles')
      .select('role, school_id')
      .eq('id', user.id)
      .single();

    const isSuperAdmin = profile?.role === 'super_admin';
    const schoolId = await getCurrentSchoolId();

    // ============================================================
    // PHASE 1: DELETE existing data in REVERSE dependency order
    // ============================================================
    const deleteOrder = [...BACKUP_TABLES].reverse();
    let deleteErrors = 0;

    for (const table of deleteOrder) {
      // Skip system tables for non-super-admin (they can't delete them anyway)
      if (table.system && !isSuperAdmin) continue;

      try {
        let delQuery = supabaseClient.from(table.name).delete();

        if (!isSuperAdmin && schoolId && table.schoolScoped) {
          // School-scoped delete
          if (table.name === 'sub_admin_modules' || table.name === 'sub_admin_activities') {
            // These tables reference sub_admins, not school_id directly.
            // Fetch sub_admin ids for this school, then delete by those.
            const { data: subAdmins } = await supabaseClient
              .from('sub_admins')
              .select('id')
              .eq('school_id', schoolId);
            const subAdminIds = (subAdmins || []).map(sa => sa.id);
            if (subAdminIds.length > 0) {
              const { error: delErr } = await delQuery.in('sub_admin_id', subAdminIds);
              if (delErr) {
                console.warn(`Could not delete from ${table.name}: ${delErr.message}`);
                deleteErrors++;
              }
            }
          } else if (table.name === 'exam_subjects' || table.name === 'exam_student_details') {
            // These tables reference exams, not school_id directly.
            // Fetch exam ids for this school, then delete by those.
            const { data: exams } = await supabaseClient
              .from('exams')
              .select('id')
              .eq('school_id', schoolId);
            const examIds = (exams || []).map(e => e.id);
            if (examIds.length > 0) {
              const { error: delErr } = await delQuery.in(
                table.name === 'exam_subjects' ? 'exam_id' : 'exam_id',
                examIds
              );
              if (delErr) {
                console.warn(`Could not delete from ${table.name}: ${delErr.message}`);
                deleteErrors++;
              }
            }
          } else if (table.name === 'school_modules') {
            // school_modules has school_id directly
            const { error: delErr } = await delQuery.eq('school_id', schoolId);
            if (delErr) {
              console.warn(`Could not delete from ${table.name}: ${delErr.message}`);
              deleteErrors++;
            }
          } else if (!NO_SCHOOL_ID_TABLES.includes(table.name)) {
            const { error: delErr } = await delQuery.eq('school_id', schoolId);
            if (delErr) {
              console.warn(`Could not delete from ${table.name}: ${delErr.message}`);
              deleteErrors++;
            }
          }
        } else if (isSuperAdmin) {
          // Super admin: delete ALL records in each table.
          // Different tables have different columns, so try multiple strategies:
          // 1. Try neq on id (tables with UUID id column)
          let delErr = null;
          
          if (table.name === 'modules') {
            // modules PK is name (TEXT)
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('name', '');
            delErr = e;
          } else if (table.name === 'settings') {
            // settings PK is id (TEXT)
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('id', '');
            delErr = e;
          } else if (table.name === 'school_settings') {
            // school_settings PK is school_id (UUID)
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('school_id', '00000000-0000-0000-0000-000000000000');
            delErr = e;
          } else if (table.name === 'grading_systems') {
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('id', '00000000-0000-0000-0000-000000000000');
            delErr = e;
          } else if (table.name === 'sub_admin_modules') {
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('id', '00000000-0000-0000-0000-000000000000');
            delErr = e;
          } else if (table.name === 'exam_subjects' || table.name === 'exam_student_details') {
            // These tables have id columns but no school_id
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('id', '00000000-0000-0000-0000-000000000000');
            delErr = e;
          } else {
            // Default: try neq on id
            const { error: e } = await supabaseClient
              .from(table.name)
              .delete()
              .neq('id', '00000000-0000-0000-0000-000000000000');
            delErr = e;
          }

          if (delErr) {
            console.warn(`Could not delete from ${table.name}: ${delErr.message}`);
            deleteErrors++;
          }
        }
      } catch (err) {
        console.warn(`Error deleting from ${table.name}: ${err.message}`);
        deleteErrors++;
      }
    }

    // ============================================================
    // PHASE 2: INSERT data in FORWARD dependency order
    // ============================================================
    let restoredCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const table of BACKUP_TABLES) {
      const records = pendingRestoreData.data[table.name] || [];
      if (records.length === 0) continue;

      // Skip system tables for non-super-admin
      if (table.system && !isSuperAdmin) continue;

      // Insert records in batches
      const batchSize = 25;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        // Clean records: remove fields that shouldn't be inserted
        const cleanBatch = batch.map(rec => {
          const clean = { ...rec };
          
          // Remove fields that are auto-generated or should not be restored
          delete clean.updated_at; // Let the DB set this
          
          // Remove GENERATED columns (cannot insert non-DEFAULT values into them)
          if (table.name === 'fees') {
            // fees.balance is GENERATED ALWAYS AS (total_amount - amount_paid) STORED
            delete clean.balance;
          }
          
          // For the settings table, keep the id (it's 'singleton' or school-specific)
          // For all other tables, keep the id to preserve FK relationships
          
          return clean;
        });

        try {
          let insErr = null;

          // Use the correct conflict column for each table type
          if (table.name === 'modules') {
            // modules PK is name (TEXT)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'name' });
            insErr = e;
          } else if (table.name === 'settings') {
            // settings PK is id (TEXT)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'id' });
            insErr = e;
          } else if (table.name === 'school_settings') {
            // school_settings PK is school_id (UUID)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'school_id' });
            insErr = e;
          } else if (table.name === 'sub_admin_modules') {
            // sub_admin_modules has unique(sub_admin_id, module_name)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'sub_admin_id,module_name' });
            insErr = e;
          } else if (table.name === 'exam_subjects') {
            // exam_subjects has unique(exam_id, class_name, subject)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'exam_id,class_name,subject' });
            insErr = e;
          } else if (table.name === 'exam_student_details') {
            // exam_student_details has unique(exam_id, student_id)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'exam_id,student_id' });
            insErr = e;
          } else if (table.name === 'teacher_classes_subjects') {
            // teacher_classes_subjects has unique(teacher_id, class_name, subject_name)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'teacher_id,class_name,subject_name' });
            insErr = e;
          } else if (table.name === 'school_modules') {
            // school_modules has unique(school_id, module_name)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'school_id,module_name' });
            insErr = e;
          } else if (table.name === 'grading_systems') {
            // grading_systems has unique(school_id, subject_name, grade_label)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'school_id,subject_name,grade_label' });
            insErr = e;
          } else if (table.name === 'class_fees') {
            // class_fees has unique(class_name, academic_year, term, school_id)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'class_name,academic_year,term,school_id' });
            insErr = e;
          } else if (table.name === 'fees') {
            // fees has unique(student_id, academic_year, term)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'student_id,academic_year,term' });
            insErr = e;
          } else if (table.name === 'attendance') {
            // attendance has unique(student_id, date)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'student_id,date' });
            insErr = e;
          } else if (table.name === 'parent_links') {
            // parent_links has unique(parent_user_id, student_id)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'parent_user_id,student_id' });
            insErr = e;
          } else if (table.name === 'exam_results') {
            // exam_results has unique(exam_id, student_id, subject)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'exam_id,student_id,subject' });
            insErr = e;
          } else if (table.name === 'fee_categories') {
            // fee_categories has unique(school_id, name)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'school_id,name' });
            insErr = e;
          } else if (table.name === 'classes') {
            // classes has unique(school_id, name)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'school_id,name' });
            insErr = e;
          } else if (table.name === 'subjects') {
            // subjects has unique(school_id, name)
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'school_id,name' });
            insErr = e;
          } else {
            // Default: use id as the conflict column
            const { error: e } = await supabaseClient
              .from(table.name)
              .upsert(cleanBatch, { onConflict: 'id' });
            insErr = e;
          }

          if (insErr) {
            // If upsert with onConflict fails, try plain insert
            const { error: insErr2 } = await supabaseClient
              .from(table.name)
              .insert(cleanBatch);

            if (insErr2) {
              console.error(`Error restoring ${table.name} batch: ${insErr2.message}`);
              errors.push(`${table.name}: ${insErr2.message}`);
              errorCount++;
            } else {
              restoredCount += batch.length;
            }
          } else {
            restoredCount += batch.length;
          }
        } catch (err) {
          console.error(`Error restoring ${table.name}: ${err.message}`);
          errors.push(`${table.name}: ${err.message}`);
          errorCount++;
        }
      }
    }

    // ============================================================
    // PHASE 3: Post-restore verification
    // ============================================================
    let verificationMsg = '';
    try {
      const { count: studentCount } = await supabaseClient
        .from('applications')
        .select('*', { count: 'exact', head: true });
      
      const backupStudentCount = (pendingRestoreData.data.applications || []).length;
      
      if (studentCount !== backupStudentCount) {
        verificationMsg = ` ⚠️ Verification: ${studentCount} students in DB vs ${backupStudentCount} in backup.`;
      } else {
        verificationMsg = ` ✅ Verified: ${studentCount} students restored correctly.`;
      }
    } catch (verifyErr) {
      console.warn('Verification failed:', verifyErr.message);
    }

    const msg = errorCount > 0
      ? `⚠️ Restore completed with ${errorCount} errors. ${restoredCount} records restored.${verificationMsg} Check console for details.`
      : `✅ Restore complete! ${restoredCount} records restored.${verificationMsg}`;

    showMessage('backupMessage', msg, errorCount > 0 ? 'warning' : 'success');

    // Clear file input
    getEl('backupFileInput').value = '';
    getEl('restorePreview').style.display = 'none';
    pendingRestoreData = null;

    // Refresh the page data after restore
    if (window.loadAdminDashboardHome) {
      setTimeout(() => window.loadAdminDashboardHome(), 1000);
    }

  } catch (err) {
    showMessage('backupMessage', 'Error during restore: ' + err.message, 'error');
    console.error('Restore error:', err);
  } finally {
    setLoading(btn, false, '⚠️ Confirm & Restore');
  }
}