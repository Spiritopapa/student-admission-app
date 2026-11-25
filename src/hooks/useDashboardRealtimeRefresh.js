import { useEffect, useId, useRef } from 'react';
import { supabase } from '../lib/supabase';

const DASHBOARD_TABLES = {
  admin: [
    'applications',
    'classes',
    'teachers',
    'fees',
    'attendance',
    'payment_transactions',
    'transport_fee_payments',
    'receipts',
    'school_modules',
    'schools',
  ],
  teacher: ['teachers', 'applications', 'teacher_classes_subjects', 'attendance'],
  student: [
    'applications',
    'fees',
    'payment_transactions',
    'receipts',
    'attendance',
    'announcements',
    'exams',
    'exam_results',
  ],
  parent: ['parent_links', 'applications', 'fees', 'receipts', 'announcements'],
  accountant: ['receipts', 'payment_transactions'],
  superadmin: ['schools', 'school_applications', 'applications', 'teachers'],
};

export function useDashboardRealtimeRefresh(dashboard, onChange, enabled = true) {
  const instanceId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return undefined;

    const tables = DASHBOARD_TABLES[dashboard];
    if (!tables) throw new Error(`Unknown dashboard realtime scope: ${dashboard}`);

    let active = true;
    let refreshTimer = null;
    const channel = supabase.channel(`dashboard-${dashboard}-${instanceId}`);
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (active) onChangeRef.current();
      }, 300);
    };

    tables.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleRefresh
      );
    });

    channel.subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`Realtime refresh failed for the ${dashboard} dashboard.`, error || status);
      }
    });

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [dashboard, enabled, instanceId]);
}
