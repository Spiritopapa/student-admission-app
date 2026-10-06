import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { uploadFile, randomPath } from '../lib/storage';
import { currentAcademicYear } from '../lib/constants';
import { logStaffActivity, logStudentActivity } from '../lib/activity';

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

  // Self-heal: RLS blocks the pre-signup school_id lookup, so older staff
  // profiles may have been created with NULL school_id. If the staff record
  // carries the school, backfill the profile so dashboards never show
  // "No school linked".
  const healProfileSchool = async (record) => {
    if (!record?.school_id || profile?.school_id) return;
    const { error: healErr } = await supabase
      .from('profiles')
      .update({ school_id: record.school_id })
      .eq('id', user.id);
    if (!healErr) profile = { ...profile, school_id: record.school_id };
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
    await healProfileSchool(record);
  }

  if (role === 'teacher') {
    const record = await approvalFlow('teachers', 'auto_approve_teacher_on_login', 'Sub Administrator');
    await healProfileSchool(record);
  }

  if (role === 'accountant') {
    const record = await approvalFlow('accountants', 'auto_approve_accountant_on_login', 'Sub Administrator');
    await healProfileSchool(record);
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

  if (role === 'parent') {
    // Self-heal a broken registration: if the ward link or profile school_id
    // was not saved (RLS / email-confirmation interruption), reconnect using
    // the ward_id stored on the auth profile at sign-up.
    const { data: links } = await supabase
      .from('parent_links')
      .select('student_id, school_id')
      .eq('parent_user_id', user.id);

    const wardGuess = user.user_metadata?.ward_id || null;
    if ((!links || !links.length) && wardGuess) {
      try {
        await supabase.rpc('link_ward_to_parent', { p_student_id: wardGuess });
      } catch (err) {
        // best effort — the Connect-a-Ward screen handles remaining cases
      }
    }

    let schoolId = profile?.school_id || null;
    if (!schoolId && links?.length) {
      schoolId = links[0].school_id || null;
      if (!schoolId) {
        const { data: app } = await supabase
          .from('applications')
          .select('school_id')
          .eq('student_id', links[0].student_id)
          .maybeSingle();
        schoolId = app?.school_id || null;
      }
    }
    if (schoolId && profile?.school_id !== schoolId) {
      try {
        await supabase.from('profiles').update({ school_id: schoolId }).eq('id', user.id);
      } catch (err) {
        // keep in-memory value anyway
      }
      profile = { ...profile, school_id: schoolId };
    }
    return { profile, app: null };
  }

  return { profile, app: null };
}

// School identity used while the app prepares the workspace (AuthLoader): the
// logo + name shown on the "Preparing your workspace..." splash screen.
async function fetchSchoolBranding(schoolId) {
  if (!schoolId) return null;
  const { data } = await supabase
    .from('school_settings')
    .select('school_name, logo_url')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (data) return { school_name: data.school_name || '', logo_url: data.logo_url || '' };
  const { data: school } = await supabase.from('schools').select('name, logo_url').eq('id', schoolId).maybeSingle();
  return school ? { school_name: school.name || '', logo_url: school.logo_url || '' } : null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [schoolBranding, setSchoolBranding] = useState(null);

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
    setSchoolBranding(await fetchSchoolBranding(child.profile?.school_id || child.app?.school_id || null));
    setLoading(false);
    return { user: session.user, ...child };
  }, []);

  useEffect(() => {
    // NOTE: no "initialized" guard here. React.StrictMode (development) mounts
    // effects, unmounts them, then mounts again. With the guard, the cleanup
    // would unsubscribe the listener on the simulated unmount and it would never
    // be re-subscribed, leaving the provider without auth events in dev. Letting
    // each mount subscribe and unsubscribe keeps exactly one active listener.
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
            // Keep an existing profile if the just-fetched one is missing; never
            // clobber a valid profile with null.
            setProfile((prev) => child.profile || prev);
            setSchoolBranding(await fetchSchoolBranding(child.profile?.school_id || child.app?.school_id || null));
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
          setSchoolBranding(await fetchSchoolBranding(child.profile?.school_id || child.app?.school_id || null));
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
    setSchoolBranding(await fetchSchoolBranding(child.profile?.school_id || child.app?.school_id || null));
    // Audit trail: record the sign-in for teachers, accountants & students
    // (matches the legacy app's activity log). Fail-safe.
    const role = String(child.profile?.role || '').toLowerCase();
    if (role === 'teacher' || role === 'accountant') {
      logStaffActivity('Logged in', { role, entityType: 'auth' }).catch(() => {});
    } else if (role === 'student') {
      logStudentActivity('Logged in', { entityType: 'auth' }).catch(() => {});
    }
    return { user: data.user, profile: child.profile, app: child.app };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSchoolBranding(null);
  }, []);

  const updateProfile = useCallback(
    async (patch) => {
      if (!user) return;

      const role = (profile?.role || user.user_metadata?.role || '').toLowerCase();

      // Primary write: the profiles row is what the header, guards and dashboard
      // greetings read from. Surface any DB-level failure (for example the
      // accountant name-lock trigger) instead of silently saving nothing while
      // the UI pretends the change went through.
      const { error: profileErr } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id);
      if (profileErr) throw new Error(profileErr.message);

      // Mirror the editable fields into the role's source-of-truth table so the
      // change also shows up everywhere else the user appears:
      //   teacher    -> teachers.full_name / phone / photo_url
      //   accountant -> accountants.full_name / phone / photo_url
      //   sub_admin  -> sub_admins.full_name
      //   admin      -> schools.admin_name / admin_photo_url
      // (schools.email / schools.phone are NOT touched - those are the school's
      // official contact used for SMS + public listing, separate from the
      // administrator's personal detail fields edited on the profile page.)
      const mirror = {};
      if (patch.full_name !== undefined) mirror.full_name = patch.full_name;
      if (patch.phone !== undefined) mirror.phone = patch.phone;
      if (patch.photo_url !== undefined) mirror.photo_url = patch.photo_url;

      try {
        if (role === 'teacher' && Object.keys(mirror).length) {
          await supabase.from('teachers').update(mirror).eq('user_id', user.id);
        } else if (role === 'accountant' && Object.keys(mirror).length) {
          await supabase.from('accountants').update(mirror).eq('user_id', user.id);
        } else if (role === 'sub_admin') {
          if (mirror.full_name !== undefined) {
            await supabase.from('sub_admins').update({ full_name: mirror.full_name }).eq('user_id', user.id);
          }
        } else if (role === 'admin') {
          if (mirror.full_name !== undefined) {
            await supabase.from('schools').update({ admin_name: mirror.full_name }).eq('user_id', user.id);
          }
          if (mirror.photo_url !== undefined) {
            await supabase.from('schools').update({ admin_photo_url: mirror.photo_url }).eq('user_id', user.id);
          }
        }
      } catch (mirrorErr) {
        // The profiles row already saved; only the display mirror failed. Keep
        // the primary save intact but make sure the failure is visible so the
        // user is never left believing the sync fully happened when it did not.
        console.warn('Could not mirror profile update into staff record:', mirrorErr.message);
      }

      // Update the in-memory profile so headers / greetings reflect instantly.
      setProfile((prev) => ({ ...(prev || {}), ...patch }));
    },
    [user, profile]
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
    // Direct table reads are RLS-blocked for unauthenticated visitors, so pull
    // the school_id through the anon-safe SECURITY DEFINER RPC first — otherwise
    // the profile would be created with a NULL school_id and the dashboard would
    // show "No school linked". The direct read is kept as a fallback (it also
    // supplies the student's name when the RPC is absent).
    let studentInfo = null;
    try {
      const rpcRes = await supabase.rpc('get_student_registration_info', { p_student_id: id }).single();
      if (!rpcRes.error && rpcRes.data) studentInfo = rpcRes.data;
    } catch (rpcErr) {
      console.warn('get_student_registration_info failed:', rpcErr.message);
    }
    if (!studentInfo) {
      const directRes = await supabase
        .from('applications')
        .select('first_name, last_name, school_id, class_applying')
        .eq('student_id', id)
        .single();
      if (!directRes.error) studentInfo = directRes.data;
    }
    const fullName = studentInfo?.first_name
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
    let schoolId = null;
    try {
      const rpcRes = await supabase.rpc('get_student_registration_info', { p_student_id: wardId }).single();
      if (!rpcRes.error && rpcRes.data?.school_id) schoolId = rpcRes.data.school_id;
    } catch (rpcErr) {
      console.warn('get_student_registration_info failed:', rpcErr.message);
    }
    if (!schoolId) {
      const { data: app } = await supabase
        .from('applications')
        .select('school_id')
        .eq('student_id', wardId)
        .maybeSingle();
      schoolId = app?.school_id || null;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          role: 'parent',
          school_id: schoolId,
          phone,
          // Persisted so an interrupted registration can be healed on first login.
          ward_id: wardId,
        },
      },
    });
    if (error) throw new Error(error.message);
    if (data?.user) {
      // Link the ward through the dedicated RPC (works when the sign-up returns
      // an active session and applies the same contact-guard as the dashboard's
      // "Connect a ward" flow). Falls back to a direct insert (permitted by the
      // parent_links RLS policy added in sql/084).
      try {
        const link = await supabase.rpc('link_ward_to_parent', { p_student_id: wardId });
        if (!link?.data?.success) {
          const { error: linkErr } = await supabase.from('parent_links').insert({
            parent_user_id: data.user.id,
            student_id: wardId,
            school_id: schoolId,
          });
          if (linkErr) throw new Error(linkErr.message);
        }
        if (schoolId) {
          await supabase.from('profiles').update({ school_id: schoolId }).eq('id', data.user.id);
        }
      } catch (linkError) {
        // The account still exists; login self-healing (applyGuards) retries the
        // link using the ward_id stored in the sign-up metadata.
        console.warn('registerParent: could not auto-link ward:', linkError.message);
      }
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
    let schoolId = subAdmin?.school_id || null;
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
      // RLS blocked the pre-signup read, so school_id may still be null here.
      // The record is now linked to this user — read the school_id back and
      // write it into the profile so the admin dashboard isn't left showing
      // "No school linked".
      if (!schoolId) {
        const { data: linkedSub } = await supabase
          .from('sub_admins')
          .select('school_id')
          .eq('user_id', data.user.id)
          .maybeSingle();
        if (linkedSub?.school_id) schoolId = linkedSub.school_id;
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
    // Direct table reads are RLS-blocked for unauthenticated visitors, so look
    // the record up through the anon-safe SECURITY DEFINER RPC first — otherwise
    // the profile would be created with a NULL school_id and the dashboard would
    // show "No school linked". Falls back to the direct read if the RPC is absent.
    let teacherInfo = null;
    try {
      const rpcRes = await supabase.rpc('get_teacher_registration_info', { p_registration_id: id }).single();
      if (!rpcRes.error && rpcRes.data) teacherInfo = rpcRes.data;
    } catch (rpcErr) {
      console.warn('get_teacher_registration_info failed:', rpcErr.message);
    }
    if (!teacherInfo) {
      const directRes = await supabase
        .from('teachers')
        .select('full_name, school_id')
        .eq('registration_id', id)
        .single();
      if (!directRes.error) teacherInfo = directRes.data;
    }
    const fullName = teacherInfo?.full_name || id;
    const schoolId = teacherInfo?.school_id || null;
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
    // Direct table reads are RLS-blocked for unauthenticated visitors, so look
    // the record up through the anon-safe SECURITY DEFINER RPC first — otherwise
    // the profile would be created with a NULL school_id and the dashboard would
    // show "No school linked". Falls back to the direct read if the RPC is absent.
    let accountantInfo = null;
    try {
      const rpcRes = await supabase.rpc('get_accountant_registration_info', { p_registration_id: id }).single();
      if (!rpcRes.error && rpcRes.data) accountantInfo = rpcRes.data;
    } catch (rpcErr) {
      console.warn('get_accountant_registration_info failed:', rpcErr.message);
    }
    if (!accountantInfo) {
      const directRes = await supabase
        .from('accountants')
        .select('full_name, school_id')
        .eq('registration_id', id)
        .single();
      if (!directRes.error) accountantInfo = directRes.data;
    }
    const fullName = accountantInfo?.full_name || id;
    const schoolId = accountantInfo?.school_id || null;
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
    // IDs are generated in uppercase (e.g. SCH-SIS-0001); normalise whatever
    // the administrator typed so the lookup, the sign-up email and the linked
    // school row all use the canonical form.
    const id = regId.trim().toUpperCase();
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
          academic_year: currentAcademicYear(),
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
          // Keep the new administrator's auth profile in sync so their own
          // portal header/dashboard shows the photo they chose at onboarding
          // (profiles.photo_url is what the header reads).
          try {
            await supabase
              .from('profiles')
              .update({ photo_url: stored })
              .eq('id', data.user.id);
          } catch (profilePhotoErr) {
            console.warn('Could not save admin photo to profile:', profilePhotoErr.message);
          }
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
      schoolBranding,
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
      schoolBranding,
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