import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export function useSchoolId() {
  const { profile } = useAuth();
  return profile?.school_id || null;
}

export function useSchoolSettings() {
  const schoolId = useSchoolId();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!schoolId) {
      setSettings(null);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('school_settings')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (data) {
      setSettings(data);
    } else {
      const { data: school } = await supabase
        .from('schools')
        .select('name, logo_url')
        .eq('id', schoolId)
        .maybeSingle();
      setSettings({
        school_name: school?.name || 'My School',
        academic_year: '2025/2026',
        current_term: 'First',
        logo_url: school?.logo_url || '',
        school_id: schoolId,
      });
    }
    setLoading(false);
  }, [schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  return { settings, loading, reload: load };
}

export function useStudentApplication() {
  const { user } = useAuth();
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setApplication(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('applications')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    setApplication(data || null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { application, loading, reload: load };
}