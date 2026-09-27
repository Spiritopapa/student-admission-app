import { useEffect, useMemo, useState } from 'react';
import { Bus, Plus, Pencil, Trash2, UserRound, Wallet } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { buildStudentName } from '../../lib/format';
import { cedi, formatDate } from '../../lib/format';

const TABS = [
  { value: 'routes', label: 'Routes' },
  { value: 'enroll', label: 'Enrollments' },
  { value: 'collect', label: 'Daily Collection' },
  { value: 'collectors', label: 'Collectors' },
];

export default function AdminTransport() {
  const schoolId = useSchoolId();
  const toast = useToast();
  const [tab, setTab] = useState('routes');

  const [routes, setRoutes] = useState([]);
  const [students, setStudents] = useState([]);
  const [teacherCollectors, setTeacherCollectors] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [collectorRoutes, setCollectorRoutes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [routeOpen, setRouteOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const [routeForm, setRouteForm] = useState({ name: '', description: '', fee: '' });
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [deletingRoute, setDeletingRoute] = useState(null);

  const [enrollRoute, setEnrollRoute] = useState('');
  const [collectDate, setCollectDate] = useState(new Date().toISOString().split('T')[0]);
  const [collectRoute, setCollectRoute] = useState('');
  const [savingCollect, setSavingCollect] = useState(false);

  const loadAll = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [routesRes, studentsRes, collectorsRes, enrollRes, collectorAssignments, paysRes] = await Promise.all([
        supabase.from('transport_routes').select('*').eq('school_id', schoolId).order('name'),
        supabase.from('applications').select('id, student_id, first_name, middle_name, last_name, class_applying').eq('school_id', schoolId).eq('status', 'admitted').order('last_name'),
        supabase.from('teachers').select('id, full_name, registration_id, class_taught').eq('school_id', schoolId).eq('is_transport_collector', true).order('full_name'),
        supabase.from('transport_enrollments').select('*').eq('school_id', schoolId),
        supabase.from('transport_collector_routes').select('*').eq('school_id', schoolId),
        supabase.from('transport_fee_payments').select('*').eq('school_id', schoolId).order('collection_date', { ascending: false }).limit(500),
      ]);
      setRoutes(routesRes.data || []);
      setStudents(studentsRes.data || []);
      setTeacherCollectors(collectorsRes.data || []);
      setEnrollments(enrollRes.data || []);
      setCollectorRoutes(collectorAssignments.data || []);
      setPayments(paysRes.data || []);
    } catch (err) {
      toast.error('Could not load transport data', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const enrolledByRoute = useMemo(() => {
    const map = {};
    enrollments.forEach((e) => {
      if (!e.is_active) return;
      if (!map[e.route_id]) map[e.route_id] = [];
      map[e.route_id].push(e.student_id);
    });
    return map;
  }, [enrollments]);

  const paymentKeys = useMemo(() => {
    const set = new Set();
    payments.forEach((p) => {
      if (p.route_id === collectRoute && p.collection_date === collectDate) set.add(p.student_id);
    });
    return set;
  }, [payments, collectRoute, collectDate]);

  const setRoute = (key) => (e) => setRouteForm((f) => ({ ...f, [key]: e.target.value }));

  const openAddRoute = () => {
    setEditingRoute(null);
    setRouteForm({ name: '', description: '', fee: '' });
    setRouteError('');
    setRouteOpen(true);
  };

  const openEditRoute = (row) => {
    setEditingRoute(row);
    setRouteForm({ name: row.name, description: row.description || '', fee: String(row.fee || 0) });
    setRouteError('');
    setRouteOpen(true);
  };

  const saveRoute = async () => {
    setRouteError('');
    if (!routeForm.name.trim()) {
      setRouteError('Route name is required.');
      return;
    }
    setRouteBusy(true);
    try {
      const payload = { name: routeForm.name.trim(), description: routeForm.description.trim(), fee: Number(routeForm.fee || 0), school_id: schoolId };
      if (editingRoute) {
        const { error: updateError } = await supabase.from('transport_routes').update(payload).eq('id', editingRoute.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Route updated', payload.name);
      } else {
        const { error: insertError } = await supabase.from('transport_routes').insert([payload]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Route added', payload.name);
      }
      setRouteOpen(false);
      loadAll();
    } catch (err) {
      setRouteError(err.message);
    } finally {
      setRouteBusy(false);
    }
  };

  const confirmDeleteRoute = async () => {
    if (!deletingRoute) return;
    const { error } = await supabase.from('transport_routes').delete().eq('id', deletingRoute.id);
    if (error) toast.error('Could not delete route', error.message);
    else toast.success('Route deleted', deletingRoute.name);
    setDeletingRoute(null);
    loadAll();
  };

  const toggleEnrollment = async (student, routeId) => {
    const existing = enrollments.find((e) => e.student_id === student.student_id && e.route_id === routeId);
    try {
      if (existing) {
        await supabase.from('transport_enrollments').update({ is_active: !existing.is_active }).eq('id', existing.id);
      } else {
        await supabase.from('transport_enrollments').insert([
          { school_id: schoolId, student_id: student.student_id, route_id: routeId, is_active: true },
        ]);
      }
      toast.success('Enrollment updated', buildStudentName(student.first_name, student.middle_name, student.last_name));
      loadAll();
    } catch (err) {
      toast.error('Could not update enrollment', err.message);
    }
  };

  const toggleCollectorAssignment = async (teacherId, routeId) => {
    const existing = collectorRoutes.find((c) => c.teacher_id === teacherId && c.route_id === routeId);
    try {
      if (existing) {
        await supabase.from('transport_collector_routes').delete().eq('id', existing.id);
      } else {
        await supabase.from('transport_collector_routes').insert([{ school_id: schoolId, teacher_id: teacherId, route_id: routeId }]);
      }
      loadAll();
    } catch (err) {
      toast.error('Could not update collector assignment', err.message);
    }
  };

  const loadPaymentsFor = async () => {
    const { data } = await supabase
      .from('transport_fee_payments')
      .select('*')
      .eq('route_id', collectRoute)
      .eq('collection_date', collectDate);
    setPayments((prev) => {
      const others = prev.filter((p) => !(p.route_id === collectRoute && p.collection_date === collectDate));
      return [...others, ...(data || [])];
    });
  };

  useEffect(() => {
    if (collectRoute && collectDate) loadPaymentsFor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectRoute, collectDate]);

  const collectRows = useMemo(() => {
    const route = routes.find((r) => r.id === collectRoute);
    const enrolled = enrolledByRoute[collectRoute] || [];
    return students
      .filter((s) => enrolled.includes(s.student_id))
      .map((student) => ({ student, route, paid: paymentKeys.has(student.student_id) }));
  }, [students, routes, collectRoute, enrolledByRoute, paymentKeys]);

  const saveCollection = async () => {
    if (!collectRoute || !collectRows.length) return;
    setSavingCollect(true);
    try {
      const route = routes.find((r) => r.id === collectRoute);
      const { data: { user } } = await supabase.auth.getUser();
      for (const row of collectRows) {
        const existing = payments.find(
          (p) => p.student_id === row.student.student_id && p.route_id === collectRoute && p.collection_date === collectDate
        );
        if (row.paid) {
          if (!existing) {
            await supabase.from('transport_fee_payments').insert([
              {
                school_id: schoolId,
                student_id: row.student.student_id,
                route_id: collectRoute,
                fee_amount: route?.fee || 0,
                collection_date: collectDate,
                payment_method: 'Cash',
                collected_by: user?.id || null,
              },
            ]);
          }
        } else if (existing) {
          await supabase.from('transport_fee_payments').delete().eq('id', existing.id);
        }
      }
      toast.success('Collection saved', `${collectRows.filter((r) => r.paid).length} students paid on ${collectDate}.`);
      loadAll();
    } catch (err) {
      toast.error('Could not save collection', err.message);
    } finally {
      setSavingCollect(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Transport System"
        subtitle="Bus routes, student enrollments and daily fee collection."
        icon={Bus}
        actions={
          tab === 'routes' ? (
            <Button onClick={openAddRoute}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add route
            </Button>
          ) : null
        }
      />

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${tab === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading transport data..." />
      ) : tab === 'routes' ? (
        routes.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {routes.map((route) => (
              <Card key={route.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                      <Bus className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{route.name}</p>
                      <p className="text-xs text-slate-400">{route.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openEditRoute(route)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit route">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setDeletingRoute(route)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete route">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-3">
                  <Badge tone="amber">{cedi(route.fee)} / day</Badge>
                  <Badge tone={route.is_active ? 'green' : 'slate'}>{route.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={Bus} title="No routes yet" message="Add bus routes so students can be enrolled for daily transport." action={<Button onClick={openAddRoute}>Add route</Button>} />
        )
      ) : tab === 'enroll' ? (
        <>
          <div className="mb-4 max-w-xs">
            <Select label="Route *" value={enrollRoute} onChange={(e) => setEnrollRoute(e.target.value)}>
              <option value="">Select route...</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({cedi(r.fee)})
                </option>
              ))}
            </Select>
          </div>
          {enrollRoute ? (
            <Card className="overflow-hidden">
              <div className="divide-y divide-slate-100">
                {students.length ? (
                  students.map((s) => {
                    const active = (enrolledByRoute[enrollRoute] || []).includes(s.student_id);
                    return (
                      <div key={s.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{buildStudentName(s.first_name, s.middle_name, s.last_name)}</p>
                          <p className="text-xs text-slate-400">{s.student_id} · {s.class_applying}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleEnrollment(s, enrollRoute)}
                          className={`badge cursor-pointer transition-colors ${active ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-700'}`}
                        >
                          {active ? 'Enrolled' : 'Enroll'}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <p className="px-4 py-6 text-sm text-slate-400">No admitted students to enroll.</p>
                )}
              </div>
            </Card>
          ) : (
            <EmptyState icon={UserRound} title="Pick a route" message="Select a route to assign students." />
          )}
        </>
      ) : tab === 'collect' ? (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Select label="Route *" value={collectRoute} onChange={(e) => setCollectRoute(e.target.value)}>
              <option value="">Select route...</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({cedi(r.fee)})
                </option>
              ))}
            </Select>
            <Input label="Date *" type="date" value={collectDate} onChange={(e) => setCollectDate(e.target.value)} max={new Date().toISOString().split('T')[0]} />
          </div>
          <Card className="overflow-hidden">
            {collectRoute ? (
              collectRows.length ? (
                <div className="divide-y divide-slate-100">
                  {collectRows.map((row) => (
                    <div key={row.student.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{buildStudentName(row.student.first_name, row.student.middle_name, row.student.last_name)}</p>
                        <p className="text-xs text-slate-400">{row.student.student_id} · {row.route?.fee ? cedi(row.route.fee) : 'No fee'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPayments((prev) =>
                            row.paid
                              ? prev.filter((p) => !(p.student_id === row.student.student_id && p.route_id === collectRoute && p.collection_date === collectDate))
                              : [
                                  ...prev,
                                  {
                                    id: `temp-${row.student.student_id}`,
                                    school_id: schoolId,
                                    student_id: row.student.student_id,
                                    route_id: collectRoute,
                                    fee_amount: row.route?.fee || 0,
                                    collection_date: collectDate,
                                  },
                                ]
                          )
                        }
                        className={`badge cursor-pointer transition-colors ${row.paid ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'}`}
                      >
                        {row.paid ? 'Paid' : 'Mark paid'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-6 text-sm text-slate-400">No students enrolled on this route.</p>
              )
            ) : (
              <EmptyState icon={Wallet} title="Pick a route" message="Select a route and date to take the daily collection." />
            )}
          </Card>
          <div className="mt-4 flex items-center justify-end gap-2">
            <p className="text-sm text-slate-500">
              {cedi(collectRows.filter((r) => r.paid).reduce((s, r) => s + Number(r.route?.fee || 0), 0))} collected
            </p>
            <Button onClick={saveCollection} loading={savingCollect} disabled={!collectRoute || !collectRows.length}>
              <Wallet className="h-4 w-4" aria-hidden="true" />
              Save collection
            </Button>
          </div>
        </>
      ) : (
        <div>
            {teacherCollectors.length ? (
              <div className="space-y-6">
                {teacherCollectors.map((teacher) => (
                  <div key={teacher.id}>
                    <div className="mb-3">
                      <p className="text-sm font-bold text-slate-800">{teacher.full_name}</p>
                      <p className="text-xs text-slate-400">{teacher.registration_id} · {teacher.class_taught || 'No class'} · Transport collector</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {routes.map((route) => {
                        const assigned = collectorRoutes.some((c) => c.teacher_id === teacher.id && c.route_id === route.id);
                        return (
                          <button
                            key={route.id}
                            type="button"
                            onClick={() => toggleCollectorAssignment(teacher.id, route.id)}
                            className={`badge cursor-pointer transition-colors ${assigned ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-teal-50 hover:text-teal-700'}`}
                          >
                            {route.name} {assigned ? '✓' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={UserRound}
                title="No transport collectors"
                message="Mark a teacher as a Transport collector on the Teachers page, then assign their routes here."
              />
            )}
          </div>
      )}

      <Modal
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        title={editingRoute ? 'Edit route' : 'Add a route'}
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            <Button variant="secondary" onClick={() => setRouteOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={saveRoute} loading={routeBusy} className="flex-1">
              {editingRoute ? 'Save changes' : 'Add route'}
            </Button>
          </div>
        }
      >
        {routeError ? (
          <Alert tone="error" className="mb-4">
            {routeError}
          </Alert>
        ) : null}
        <div className="space-y-4">
          <Input label="Route name *" value={routeForm.name} onChange={setRoute('name')} placeholder="e.g. Madina" />
          <Input label="Description" value={routeForm.description} onChange={setRoute('description')} placeholder="Bus destination / pickup area" />
          <Input label="Daily fee (GHC)" type="number" min="0" step="0.01" value={routeForm.fee} onChange={setRoute('fee')} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletingRoute}
        onClose={() => setDeletingRoute(null)}
        onConfirm={confirmDeleteRoute}
        title="Delete route?"
        message="This removes the route and its enrollments. Daily collection records are kept."
      />
    </div>
  );
}