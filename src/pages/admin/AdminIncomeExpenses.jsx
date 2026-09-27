import { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import { useSchoolId } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Button, Input, Select, Spinner, EmptyState, Badge, SearchInput, StatCard } from '../../components/ui';
import { Modal, ConfirmDialog, Alert } from '../../components/ui-extras';
import { supabase } from '../../lib/supabase';
import { cedi, formatDate } from '../../lib/format';
import { PAYMENT_METHOD_LABELS } from '../../lib/constants';

const COLOR_PALETTE = ['#6366f1', '#0d9488', '#f59e0b', '#e11d48', '#0284c7', '#7c3aed', '#16a34a', '#db2777'];

export default function AdminIncomeExpenses() {
  const schoolId = useSchoolId();
  const toast = useToast();

  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [typeFilter, setTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [query, setQuery] = useState('');

  const [txOpen, setTxOpen] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [txForm, setTxForm] = useState({
    type: 'income',
    category_id: '',
    amount: '',
    description: '',
    transaction_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    reference_number: '',
    notes: '',
  });
  const [txBusy, setTxBusy] = useState(false);
  const [txError, setTxError] = useState('');

  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catForm, setCatForm] = useState({ name: '', type: 'income', description: '', color: COLOR_PALETTE[0] });
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState('');

  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [summaryRes, txRes, catRes] = await Promise.all([
        supabase.rpc('get_ie_summary', { p_school_id: schoolId }),
        supabase
          .from('income_expenses')
          .select('*')
          .eq('school_id', schoolId)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(300),
        supabase.from('income_expense_categories').select('*').eq('school_id', schoolId).order('name'),
      ]);
      if (summaryRes.error) throw new Error(summaryRes.error.message);
      if (txRes.error) throw new Error(txRes.error.message);
      if (catRes.error) throw new Error(catRes.error.message);
      setSummary(summaryRes.data || { total_income: 0, total_expense: 0, net_balance: 0, transaction_count: 0 });
      setTransactions(txRes.data || []);
      setCategories(catRes.data || []);
    } catch (err) {
      toast.error('Could not load records', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const catByType = useMemo(() => {
    const map = { income: [], expense: [] };
    categories.forEach((c) => {
      if (c.type === 'income' || c.type === 'expense') map[c.type].push(c);
    });
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter && t.type !== typeFilter) return false;
      if (fromDate && t.transaction_date < fromDate) return false;
      if (toDate && t.transaction_date > toDate) return false;
      if (q) {
        const cat = categoryMap.get(t.category_id);
        const hay = `${t.description} ${t.reference_number || ''} ${cat?.name || ''} ${t.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, typeFilter, fromDate, toDate, query, categoryMap]);

  const setTx = (key) => (e) => setTxForm((f) => ({ ...f, [key]: e.target.value }));
  const setCat = (key) => (e) => setCatForm((f) => ({ ...f, [key]: e.target.value }));

  const openAddTx = () => {
    setEditingTx(null);
    const type = typeFilter === 'expense' ? 'expense' : 'income';
    setTxForm({
      type,
      category_id: catByType[type][0]?.id || '',
      amount: '',
      description: '',
      transaction_date: new Date().toISOString().split('T')[0],
      payment_method: 'cash',
      reference_number: '',
      notes: '',
    });
    setTxError('');
    setTxOpen(true);
  };

  const openEditTx = (row) => {
    setEditingTx(row);
    setTxForm({
      type: row.type,
      category_id: row.category_id,
      amount: String(row.amount),
      description: row.description,
      transaction_date: row.transaction_date,
      payment_method: row.payment_method || 'cash',
      reference_number: row.reference_number || '',
      notes: row.notes || '',
    });
    setTxError('');
    setTxOpen(true);
  };

  const saveTx = async () => {
    setTxError('');
    const amount = Number(txForm.amount);
    if (!txForm.category_id || !txForm.description.trim() || !amount || amount <= 0) {
      setTxError('Category, description and a positive amount are required.');
      return;
    }
    setTxBusy(true);
    try {
      const payload = {
        type: txForm.type,
        category_id: txForm.category_id,
        amount,
        description: txForm.description.trim(),
        transaction_date: txForm.transaction_date,
        payment_method: txForm.payment_method,
        reference_number: txForm.reference_number.trim() || null,
        notes: txForm.notes.trim() || null,
        school_id: schoolId,
      };
      if (editingTx) {
        const { error: updateError } = await supabase.from('income_expenses').update(payload).eq('id', editingTx.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Record updated', txForm.description.trim());
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { error: insertError } = await supabase.from('income_expenses').insert([{ ...payload, recorded_by: user?.id || null }]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Record added', txForm.description.trim());
      }
      setTxOpen(false);
      load();
    } catch (err) {
      setTxError(err.message);
    } finally {
      setTxBusy(false);
    }
  };

  const openAddCat = (type) => {
    setEditingCat(null);
    setCatForm({ name: '', type: type || 'income', description: '', color: COLOR_PALETTE[categories.length % COLOR_PALETTE.length] });
    setCatError('');
    setCatOpen(true);
  };

  const openEditCat = (cat) => {
    setEditingCat(cat);
    setCatForm({ name: cat.name, type: cat.type, description: cat.description || '', color: cat.color || COLOR_PALETTE[0] });
    setCatError('');
    setCatOpen(true);
  };

  const saveCat = async () => {
    setCatError('');
    if (!catForm.name.trim()) {
      setCatError('Category name is required.');
      return;
    }
    setCatBusy(true);
    try {
      const payload = { name: catForm.name.trim(), type: catForm.type, description: catForm.description.trim(), color: catForm.color, school_id: schoolId };
      if (editingCat) {
        const { error: updateError } = await supabase.from('income_expense_categories').update(payload).eq('id', editingCat.id);
        if (updateError) throw new Error(updateError.message);
        toast.success('Category updated', payload.name);
      } else {
        const { error: insertError } = await supabase.from('income_expense_categories').insert([payload]);
        if (insertError) throw new Error(insertError.message);
        toast.success('Category added', payload.name);
      }
      setCatOpen(false);
      load();
    } catch (err) {
      setCatError(err.message);
    } finally {
      setCatBusy(false);
    }
  };

  const confirmDeleteCat = async () => {
    if (!deleting) return;
    const { error } = await supabase.from('income_expense_categories').delete().eq('id', deleting.id);
    if (error) toast.error('Could not delete category', error.message);
    else toast.success('Category deleted', deleting.name);
    setDeleting(null);
    load();
  };

  const confirmDeleteTx = async (tx) => {
    if (!tx) return;
    const { error } = await supabase.from('income_expenses').delete().eq('id', tx.id);
    if (error) toast.error('Could not delete record', error.message);
    else toast.success('Record deleted', tx.description);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Income & Expenses"
        subtitle="Record and track school finances."
        icon={Wallet}
        actions={
          <>
            <Button variant="secondary" onClick={() => openAddCat()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Category
            </Button>
            <Button onClick={openAddTx}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Record
            </Button>
          </>
        }
      />

      {loading ? (
        <Spinner label="Loading records..." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={TrendingUp} tone="green" label="Total income" value={cedi(summary?.total_income || 0)} sub={`${summary?.transaction_count || 0} transactions`} />
            <StatCard icon={TrendingDown} tone="red" label="Total expenses" value={cedi(summary?.total_expense || 0)} sub="All-time for this school" />
            <StatCard icon={Scale} tone={Number(summary?.net_balance || 0) >= 0 ? 'blue' : 'amber'} label="Net balance" value={cedi(summary?.net_balance || 0)} sub="Income minus expenses" />
          </div>

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end">
            <div className="w-full md:max-w-xs">
              <SearchInput value={query} onChange={setQuery} placeholder="Search records..." />
            </div>
            <div className="w-40">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From" />
              <span className="text-xs text-slate-400">to</span>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To" />
            </div>
          </div>

          <Card className="mt-4 overflow-hidden">
            {filtered.length ? (
              <div className="divide-y divide-slate-100">
                {filtered.map((t) => {
                  const cat = categoryMap.get(t.category_id);
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: cat?.color || '#64748b' }}>
                        {(cat?.name || '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{t.description}</p>
                        <p className="text-xs text-slate-400">
                          {cat?.name || 'Unknown'} · {formatDate(t.transaction_date)} · {PAYMENT_METHOD_LABELS[t.payment_method] || t.payment_method || 'Cash'}
                          {t.reference_number ? ` · ${t.reference_number}` : ''}
                        </p>
                      </div>
                      {t.type === 'income' ? (
                        <b className="text-sm font-bold text-emerald-600">+{cedi(t.amount)}</b>
                      ) : (
                        <b className="text-sm font-bold text-rose-600">−{cedi(t.amount)}</b>
                      )}
                      <div className="flex gap-1">
                        <button type="button" onClick={() => openEditTx(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit record">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => confirmDeleteTx(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete record">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Wallet} title="No records yet" message="Record your first income or expense to get started." />
            )}
          </Card>

          <h2 className="mt-8 text-sm font-bold text-slate-800">Categories</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((cat) => (
              <Card key={cat.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: cat.color || '#6366f1' }}>
                    {(cat.name || '?').charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{cat.name}</p>
                    <Badge tone={cat.type === 'income' ? 'green' : 'red'}>{cat.type}</Badge>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEditCat(cat)} className="rounded-lg p-1.5 text-slate-400 hover:bg-brand-50 hover:text-brand-600" aria-label="Edit category">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setDeleting(cat)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete category">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </Card>
            ))}
          </div>

          <Modal
            open={txOpen}
            onClose={() => setTxOpen(false)}
            title={editingTx ? 'Edit record' : 'Record income / expense'}
            size="lg"
            footer={
              <div className="flex w-full gap-2">
                <Button variant="secondary" onClick={() => setTxOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={saveTx} loading={txBusy} className="flex-1">
                  {editingTx ? 'Save changes' : 'Save record'}
                </Button>
              </div>
            }
          >
            {txError ? (
              <Alert tone="error" className="mb-4">
                {txError}
              </Alert>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Type *" value={txForm.type} onChange={(e) => setTxForm((f) => ({ ...f, type: e.target.value, category_id: catByType[e.target.value][0]?.id || '' }))}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
              <Select label="Category *" value={txForm.category_id} onChange={setTx('category_id')}>
                <option value="">Select category...</option>
                {catByType[txForm.type]?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input label="Amount (GHC) *" type="number" min="0" step="0.01" value={txForm.amount} onChange={setTx('amount')} />
              <Input label="Transaction date *" type="date" value={txForm.transaction_date} onChange={setTx('transaction_date')} />
              <Input label="Description *" value={txForm.description} onChange={setTx('description')} className="sm:col-span-2" placeholder="e.g. School van fuel" />
              <Select label="Payment method" value={txForm.payment_method} onChange={setTx('payment_method')}>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input label="Reference number" value={txForm.reference_number} onChange={setTx('reference_number')} />
              <Input label="Notes" value={txForm.notes} onChange={setTx('notes')} className="sm:col-span-2" />
            </div>
          </Modal>

          <Modal
            open={catOpen}
            onClose={() => setCatOpen(false)}
            title={editingCat ? 'Edit category' : 'Add a category'}
            size="sm"
            footer={
              <div className="flex w-full gap-2">
                <Button variant="secondary" onClick={() => setCatOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={saveCat} loading={catBusy} className="flex-1">
                  Save
                </Button>
              </div>
            }
          >
            {catError ? (
              <Alert tone="error" className="mb-4">
                {catError}
              </Alert>
            ) : null}
            <div className="space-y-4">
              <Input label="Name *" value={catForm.name} onChange={setCat('name')} placeholder="e.g. Tuck shop sales" />
              <Select label="Type *" value={catForm.type} onChange={setCat('type')}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </Select>
              <Input label="Description" value={catForm.description} onChange={setCat('description')} />
              <div>
                <label className="label">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCatForm((f) => ({ ...f, color: c }))}
                      className={`h-8 w-8 rounded-full ${catForm.color === c ? 'ring-2 ring-slate-800 ring-offset-2' : ''}`}
                      style={{ backgroundColor: c }}
                      aria-label={`Colour ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Modal>

          <ConfirmDialog
            open={!!deleting}
            onClose={() => setDeleting(null)}
            onConfirm={confirmDeleteCat}
            title="Delete category?"
            message="This removes the category. Existing income/expense records in it cannot be deleted while they exist."
          />
        </>
      )}
    </div>
  );
}