import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { uploadFile, randomPath } from '../lib/storage';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

function isTrialExpired(school) {
  return !!(
    school &&
    school.plan_version === 'trial' &&
    school.trial_ends_at &&
    new Date(school.trial_ends_at) < new Date()
  );
}

function friendlyLoginError(error) {
  const code = String(error.code || '').toLowerCase();
  const msg = String(error.message || '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Invalid login credentials. Check that you entered the correct ID/email and password.';
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Your account has not been verified yet. Ask your administrator to confirm your account, then sign in again.';
  }
  if (code === 'user_banned' || msg.includes('user is banned')) {
    return 'This account has been disabled. Please contact your administrator.';
  }
  if (code === 'over_email_send_rate_limit' || msg.includes('rate limit')) {
    return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }
  return error.message;
}

function resolveLoginEmail(identifier) {
  const isStudentID = /^STU-[A-Z0-9]{5}$/i.test(identifier);
  const isSubAdminID = /^SA-\d{4}$/i.test(identifier);
  const isTeacherID = /^TCH-([A-Z0-9]{1,3}-)?\d{4}$/i.test(identifier);
  const isAccountantID = /^ACC-([A-Z0-9]{1,3}-)?\d{4}$/i.test(identifier);
  const isSchoolID = /^SCH-(TRIAL-)?([A-Z0-9]{1,3}-)?\d{4}$/i.test(identifier);
  if (isStudentID) return identifier + '@student.local';
  if (isSubAdminID) return identifier.toLowerCase() + '@subadmin.local';
  if (isTeacherID) return identifier.toLowerCase() + '@teacher.local';
  if (isAccountantID) return identifier.toLowerCase() + '@accountant.local';
  if (isSchoolID) return identifier.toLowerCase() + '@school.local';
  if (identifier.includes('@')) return identifier;
  return null;
}

async function resolveStaffId(identifier) {
  try {
    const { data: staffTeacher } = await supabase.rpc('get_teacher_info_by_staff_id', {
      p_staff_id: identifier,
    });
    if (staffTeacher && staffTeacher.length > 0 && staffTeacher[0].registration_id) {
      return staffTeacher[0].registration_id.toLowerCase() + '@teacher.local';
    }
    const { data: directTeacher } = await supabase
      .from('teachers')
      .select('registration_id')
      .eq('staff_id', identifier)
      .maybeSingle();
    if (directTeacher?.registration_id) {
      return directTeacher.registration_id.toLowerCase() + '@teacher.local';
    }
  } catch (err) {
    const { data: directTeacher } = await supabase
      .from('teachers')
      .select('registration_id')
      .eq('staff_id', identifier)
      .maybeSingle();
    if (directTeacher?.registration_id) {
      return directTeacher.registration_id.toLowerCase() + '@teacher.local';
    }
  }
  return identifier;
}

async function loadChildProfile(user) {
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return profile || null;
}

async function applyGuards(user) {
  let profile = await loadChildProfile(user);
  const role = profile?.role || 'student';

  if (role === 'admin') {
    const regId = user.user_metadata?.registration_id || null;
    let { data: school } = await supabase
      .from('schools')
      .select('id, plan_version, trial_ends_at, name')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!school && regId) {
      const { data: byReg } = await supabase
        .from('schools')
        .select('id, plan_version, trial_ends_at, name')
        .eq('registration_id', regId)
        .maybeSingle();
      if (byReg) {
        const { error: linkErr } = await supabase.rpc('link_school_to_user', {
          p_registration_id: regId,
          p_user_id: user.id,
        });
        if (linkErr) {
          await supabase.from('schools').update({ user_id: user.id }).eq('registration_id', regId);
        }
        const { data: relinked } = await supabase
          .from('schools')
          .select('id, plan_version, trial_ends_at, name')
          .eq('user_id', user.id)
          .maybeSingle();
        school = relinked || byReg;
      }
    }
    if (!school) {
      await supabase.auth.signOut();
      throw new Error('School account not linked. Please contact the Super Administrator.');
    }
    if (isTrialExpired(school)) {
      await supabase.auth.signOut();
      throw new Error(
        "Your school's trial period has expired. Access is blocked until the Super Administrator renews the trial or upgrades the school to the Full version."
      );
    }
  }

  const approvalFlow = async (table, linkRpc, actorLabel) => {
    const regId = user.user_metadata?.registration_id || null;
    let { data: record } = await supabase
      .from(table)
      .select('is_approved, school_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!record && regId) {
      const { data: byReg } = await supabase
        .from(table)
        .select('is_approved, school_id')
        .eq('registration_id', regId)
        .maybeSingle();
      if (byReg && byReg.is_approved) {
        try {
          await supabase.rpc(linkRpc, { p_user_id: user.id, p_registration_id: regId });
        } catch (err) {
          try {
            await supabase
              .from(table)
              .update({ user_id: user.id, is_approved: true })
              .eq('registration_id', regId);
          } catch (innerErr) {
            // keep original
          }
        }
        record = { is_approved: true, school_id: byReg.school_id };
      }
    }
    if (!record || !record.is_approved) {
      await supabase.auth.signOut();
      throw new Error(
        `Your account is pending approval. Please wait for your ${actorLabel} to approve your account.`
      );
    }
    return record;
  };

  if (role === 'sub_admin') {
    const record = await approvalFlow('sub_admins', 'auto_approve_sub_admin_on_login', 'School Administrator');
    if (record.school_id) {
      const { data: school } = await supabase
        .from('schools')
        .select('plan_version, trial_ends_at')
        .eq('id', record.school_id)
        .maybeSingle();
      if (isTrialExpired(school)) {
        await supabase.auth.signOut();
        throw new Error(
          "Your school's trial period has expired. Access is blocked until the Super Administrator renews the trial or upgrades the school."
        );
      }
    }
  }

  if (role === 'teacher') {
    await approvalFlow('teachers', 'auto_approve_teacher_on_login', 'Sub Administrator');
  }

  if (role === 'accountant') {
    await approvalFlow('accountants', 'auto_approve_accountant_on_login', 'Sub Administrator');
  }

  if (role === 'student') {
    const studentIdGuess =
      user.user_metadata?.student_id || user.user_metadata?.registration_id || null;
    let { data: app } = await supabase
      .from('applications')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!app && studentIdGuess) {
      try {
        await supabase.rpc('auto_approve_student_on_login', {
          p_user_id: user.id,
          p_student_id: studentIdGuess,
        });
      } catch (err) {
        // best effort
      }
      const { data: healed } = await supabase
        .from('applications')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      app = healed || null;
    }
    return { profile, app };
  }

  return { profile, app: null };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const refreshSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return null;
    }
    const child = await applyGuards(session.user);
    setUser(session.user);
    setProfile(child.profile);
    setLoading(false);
    return { user: session.user, ...child };
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setLoading(true);
        supabase.auth
          .getUser()
          .then(async ({ data: { user: u } }) => {
            if (!u) return;
            const child = await applyGuards(u);
            setUser(u);
            setProfile((prev) => ({ ...(prev || {}), ...child.profile }));
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const child = await applyGuards(session.user);
          setUser(session.user);
          setProfile(child.profile);
        } catch (err) {
          setUser(null);
          setProfile(null);
        }
      }
      setLoading(false);
    });

    return () => sub?.subscription?.unsubscribe();
  }, []);

  const signIn = useCallback(async (identifier, password) => {
    let email = resolveLoginEmail(identifier.trim());
    if (email === null) {
      email = await resolveStaffId(identifier.trim());
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyLoginError(error));
    const child = await applyGuards(data.user);
    setUser(data.user);
    setProfile(child.profile);
    return { user: data.user, profile: child.profile, app: child.app };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      if (!user) return;
      await supabase.from('profiles').update(patch).eq('id', user.id);
      setProfile((prev) => ({ ...(prev || {}), ...patch }));
    },
    [user]
  );

  const superAdminExists = useCallback(async () => {
    const { data } = await supabase.rpc('super_admin_exists');
    return !!data;
  }, []);

  const registerStudent = useCallback(async ({ studentID, password, phone }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const id = studentID.trim();
    const { data: idExists } = await supabase.rpc('check_student_id_exists', { target_id: id });
    if (!idExists) {
      throw new Error('Invalid Student ID. Please check with your Sub Administrator.');
    }
    const { data: studentInfo } = await supabase
      .from('applications')
      .select('first_name, last_name, school_id, class_applying')
      .eq('student_id', id)
      .single();
    const fullName = studentInfo
      ? `${studentInfo.first_name || ''} ${studentInfo.last_name || ''}`.trim()
      : id;
    const schoolId = studentInfo?.school_id || null;
    const email = id + '@student.local';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: 'student',
          registration_id: id,
          school_id: schoolId,
          phone,
        },
      },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        role: 'student',
        school_id: schoolId,
        phone,
      });
      await supabase.from('applications').update({ user_id: data.user.id }).eq('student_id', id);
    }
    return { email, id };
  }, []);

  const registerParent = useCallback(async ({ fullName, email, password, phone, wardID }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const wardId = wardID.trim();
    const { data: wardExists } = await supabase.rpc('check_student_id_exists', {
      target_id: wardId,
    });
    if (!wardExists) {
      throw new Error('Ward Student ID not found. Please check with your Sub Administrator.');
    }
    const { data: app } = await supabase
      .from('applications')
      .select('school_id')
      .eq('student_id', wardId)
      .maybeSingle();
    const schoolId = app?.school_id || null;
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), role: 'parent', school_id: schoolId, phone } },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      await supabase.from('parent_links').insert({
        parent_user_id: data.user.id,
        student_id: wardId,
        school_id: schoolId,
      });
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName.trim(),
        email: email.trim(),
        role: 'parent',
        school_id: schoolId,
        phone,
      });
    }
    return { email: email.trim() };
  }, []);

  const registerSubAdmin = useCallback(async ({ regId, password, phone }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const id = regId.trim();
    const { data: idExists } = await supabase.rpc('check_sub_admin_id_exists', { target_id: id });
    if (!idExists) {
      throw new Error('Invalid Registration ID. Please check with your School Administrator.');
    }
    const { data: subAdmin } = await supabase
      .from('sub_admins')
      .select('full_name, school_id')
      .eq('registration_id', id)
      .single();
    const fullName = subAdmin?.full_name || id;
    const schoolId = subAdmin?.school_id || null;
    const email = id.toLowerCase() + '@subadmin.local';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: 'sub_admin', registration_id: id, school_id: schoolId, phone } },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      try {
        const { error: linkErr } = await supabase.rpc('link_sub_admin_to_user', {
          p_registration_id: id,
          p_user_id: data.user.id,
        });
        if (linkErr) {
          await supabase
            .from('sub_admins')
            .update({ user_id: data.user.id })
            .eq('registration_id', id);
        }
      } catch (err) {
        await supabase.from('sub_admins').update({ user_id: data.user.id }).eq('registration_id', id);
      }
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        role: 'sub_admin',
        school_id: schoolId,
        phone,
      });
    }
    return { email, id };
  }, []);

  const registerTeacher = useCallback(async ({ regId, password, phone }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const id = regId.trim();
    const { data: idExists } = await supabase.rpc('check_teacher_id_exists', { target_id: id });
    if (!idExists) {
      throw new Error('Invalid Registration ID. Please check with your Sub Administrator.');
    }
    const { data: teacher } = await supabase
      .from('teachers')
      .select('full_name, school_id')
      .eq('registration_id', id)
      .single();
    const fullName = teacher?.full_name || id;
    const schoolId = teacher?.school_id || null;
    const email = id.toLowerCase() + '@teacher.local';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: 'teacher', registration_id: id, school_id: schoolId, phone } },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      try {
        const { error: linkErr } = await supabase.rpc('link_teacher_to_user', {
          p_registration_id: id,
          p_user_id: data.user.id,
        });
        if (linkErr) {
          await supabase
            .from('teachers')
            .update({ user_id: data.user.id, is_approved: true })
            .eq('registration_id', id);
        }
      } catch (err) {
        await supabase
          .from('teachers')
          .update({ user_id: data.user.id, is_approved: true })
          .eq('registration_id', id);
      }
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        role: 'teacher',
        school_id: schoolId,
        phone,
      });
    }
    return { email, id };
  }, []);

  const registerAccountant = useCallback(async ({ regId, password, phone }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const id = regId.trim();
    const { data: idExists } = await supabase.rpc('check_accountant_id_exists', {
      target_id: id,
    });
    if (!idExists) {
      throw new Error('Invalid Registration ID. Please check with your Sub Administrator.');
    }
    const { data: accountant } = await supabase
      .from('accountants')
      .select('full_name, school_id')
      .eq('registration_id', id)
      .single();
    const fullName = accountant?.full_name || id;
    const schoolId = accountant?.school_id || null;
    const email = id.toLowerCase() + '@accountant.local';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role: 'accountant', registration_id: id, school_id: schoolId, phone } },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      try {
        const { error: linkErr } = await supabase.rpc('link_accountant_to_user', {
          p_registration_id: id,
          p_user_id: data.user.id,
        });
        if (linkErr) {
          await supabase
            .from('accountants')
            .update({ user_id: data.user.id, is_approved: true })
            .eq('registration_id', id);
        }
      } catch (err) {
        await supabase
          .from('accountants')
          .update({ user_id: data.user.id, is_approved: true })
          .eq('registration_id', id);
      }
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        email,
        role: 'accountant',
        school_id: schoolId,
        phone,
      });
    }
    return { email, id };
  }, []);

  const registerSuperAdmin = useCallback(async ({ fullName, email, password, phone }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const { data: exists } = await supabase.rpc('super_admin_exists');
    if (exists) {
      throw new Error('A Super Administrator already exists. Contact your existing Super Admin for access.');
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), role: 'super_admin', phone } },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName.trim(),
        email: email.trim(),
        role: 'super_admin',
        phone,
      });
    }
    return { email: email.trim() };
  }, []);

  const registerSchool = useCallback(async ({ regId, password, phone, photoFile }) => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const id = regId.trim();
    const { data: info } = await supabase.rpc('get_school_registration_info', {
      p_registration_id: id,
    });
    const row = Array.isArray(info) && info.length > 0 ? info[0] : null;
    if (!row) {
      throw new Error('No school found with that ID. Please check with your Super Administrator.');
    }
    const schoolId = row.school_id || row.id || null;
    const schoolName = row.name || row.school_name || '';
    const displayName = row.full_name || row.admin_name || schoolName || id;
    const email = id.toLowerCase() + '@school.local';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName, role: 'admin', registration_id: id, school_id: schoolId, phone } },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      try {
        const { error: linkErr } = await supabase.rpc('link_school_to_user', {
          p_registration_id: id,
          p_user_id: data.user.id,
        });
        if (linkErr) {
          await supabase.from('schools').update({ user_id: data.user.id }).eq('registration_id', id);
        }
      } catch (err) {
        await supabase.from('schools').update({ user_id: data.user.id }).eq('registration_id', id);
      }
      await supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: displayName,
        email,
        role: 'admin',
        school_id: schoolId,
        phone,
      });
      if (schoolId) {
        await supabase.from('school_settings').upsert({
          school_id: schoolId,
          school_name: schoolName,
          academic_year: '2025/2026',
          current_term: 'First',
        });
      }
      if (photoFile) {
        const path = randomPath(`admin_${schoolId || id}`, photoFile.name);
        const stored = await uploadFile('school-logos', path, photoFile);
        if (stored) {
          await supabase
            .from('schools')
            .update({ admin_photo_url: stored })
            .eq('registration_id', id);
        }
      }
    }
    return { email, id };
  }, []);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      signIn,
      signOut,
      refreshSession,
      updateProfile,
      registerStudent,
      registerParent,
      registerSubAdmin,
      registerTeacher,
      registerAccountant,
      registerSuperAdmin,
      registerSchool,
      superAdminExists,
    }),
    [
      user,
      profile,
      loading,
      signIn,
      signOut,
      refreshSession,
      updateProfile,
      registerStudent,
      registerParent,
      registerSubAdmin,
      registerTeacher,
      registerAccountant,
      registerSuperAdmin,
      registerSchool,
      superAdminExists,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}