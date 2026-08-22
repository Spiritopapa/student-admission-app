/**
 * Income & Expenditure Tracking Module
 * Comprehensive module for tracking school income and expenses
 * Features: record income/expenses, category management, date-range reporting,
 *           analytics with charts, preview/print reports
 */

import { getEl, showMessage, clearMessage, setLoading, formatCurrency, formatDate, getCurrentSchoolId, openPrintWindow } from './utils.js';

let supabaseClient = null;

// ================================================================
// INIT
// ================================================================

export function initIncomeExpenses(supabase) {
  supabaseClient = supabase;
}

// ================================================================
// STATE
// ================================================================

let _categoriesCache = [];
let _currentIeRecords = [];
let _ieFilteredRecords = [];

// ================================================================
// MAIN PAGE LOADER
// ================================================================

export async function loadIncomeExpensesPage(containerId = 'ieContainer') {
  const container = getEl(containerId);
  if (!container) return;

  const schoolId = await _getSchoolId();

  container.innerHTML = `
    <div class="ie-tabs" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
      <button type="button" class="btn btn-secondary ie-tab active" data-ie-tab="dashboard">📊 Dashboard</button>
      <button type="button" class="btn btn-secondary ie-tab" data-ie-tab="income">📈 Income</button>
      <button type="button" class="btn btn-secondary ie-tab" data-ie-tab="expense">📉 Expenses</button>
      <button type="button" class="btn btn-secondary ie-tab" data-ie-tab="categories">🏷️ Categories</button>
      <button type="button" class="btn btn-secondary ie-tab" data-ie-tab="reports">📋 Reports</button>
    </div>

    <!-- ===== DASHBOARD TAB ===== -->
    <div id="ieTab-dashboard" class="ie-content">
      <div class="ie-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1rem;">
        <div class="ie-stat-card" style="border-left:4px solid var(--success);">
          <div class="ie-stat-label">Total Income</div>
          <div class="ie-stat-value ie-income" id="ieDashIncome">GH₵ 0.00</div>
        </div>
        <div class="ie-stat-card" style="border-left:4px solid var(--danger);">
          <div class="ie-stat-label">Total Expenses</div>
          <div class="ie-stat-value ie-expense" id="ieDashExpense">GH₵ 0.00</div>
        </div>
        <div class="ie-stat-card" style="border-left:4px solid var(--primary);">
          <div class="ie-stat-label">Net Balance</div>
          <div class="ie-stat-value" id="ieDashNet">GH₵ 0.00</div>
        </div>
        <div class="ie-stat-card" style="border-left:4px solid #8b5cf6;">
          <div class="ie-stat-label">Total Transactions</div>
          <div class="ie-stat-value" id="ieDashCount">0</div>
        </div>
      </div>

      <!-- Date Range Filter -->
      <div class="card-toolbar" style="flex-wrap:wrap;margin-bottom:1rem;">
        <label style="font-size:0.85rem;font-weight:600;">Filter by Date:</label>
        <input type="date" id="ieDashFrom" class="search-input" style="max-width:150px;" />
        <input type="date" id="ieDashTo" class="search-input" style="max-width:150px;" />
        <button type="button" class="btn btn-sm btn-primary" id="ieDashFilterBtn">🔍 Apply</button>
        <button type="button" class="btn btn-sm btn-secondary" id="ieDashResetBtn">🔄 Reset</button>
        <button type="button" class="btn btn-sm btn-secondary" id="ieDashRefreshBtn">🔄 Refresh</button>
      </div>

      <!-- Category Breakdown -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div class="acc-card">
          <div class="acc-card-header">
            <h3>📈 Income by Category</h3>
          </div>
          <div id="ieDashIncomeBreakdown" class="ie-breakdown">
            <div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.85rem;">Loading...</div>
          </div>
        </div>
        <div class="acc-card">
          <div class="acc-card-header">
            <h3>📉 Expenses by Category</h3>
          </div>
          <div id="ieDashExpenseBreakdown" class="ie-breakdown">
            <div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.85rem;">Loading...</div>
          </div>
        </div>
      </div>

      <!-- Recent Transactions -->
      <div class="acc-card" style="margin-top:1rem;">
        <div class="acc-card-header">
          <h3>🕐 Recent Transactions</h3>
          <span class="acc-badge" id="ieDashRecentCount">0</span>
        </div>
        <div class="table-wrapper" style="max-height:350px;overflow-y:auto;">
          <table class="app-table">
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Recorded By</th></tr></thead>
            <tbody id="ieDashRecentBody">
              <tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted);">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ===== INCOME TAB ===== -->
    <div id="ieTab-income" class="ie-content" style="display:none;">
      <div class="card-toolbar" style="flex-wrap:wrap;">
        <h3 style="margin:0;">📈 Income Records</h3>
        <button type="button" class="btn btn-primary" id="ieAddIncomeBtn">➕ Record Income</button>
        <input type="text" id="ieIncomeSearch" placeholder="🔍 Search..." class="search-input" style="max-width:200px;" />
        <select id="ieIncomeCategory" class="filter-select" style="max-width:180px;"><option value="">All Categories</option></select>
        <input type="date" id="ieIncomeFrom" class="search-input" style="max-width:140px;" />
        <input type="date" id="ieIncomeTo" class="search-input" style="max-width:140px;" />
        <button type="button" class="btn btn-sm btn-secondary" id="ieIncomeRefresh">🔄 Refresh</button>
      </div>
      <div style="margin-bottom:0.75rem;display:flex;gap:1rem;flex-wrap:wrap;">
        <span style="font-size:0.85rem;font-weight:600;color:var(--success);">Total Income: <span id="ieIncomeTotal">GH₵ 0.00</span></span>
        <span style="font-size:0.85rem;font-weight:600;color:var(--text-muted);">Records: <span id="ieIncomeCount">0</span></span>
      </div>
      <div class="table-wrapper">
        <table class="app-table">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Reference</th><th>Action</th></tr></thead>
          <tbody id="ieIncomeBody">
            <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===== EXPENSE TAB ===== -->
    <div id="ieTab-expense" class="ie-content" style="display:none;">
      <div class="card-toolbar" style="flex-wrap:wrap;">
        <h3 style="margin:0;">📉 Expense Records</h3>
        <button type="button" class="btn btn-primary" id="ieAddExpenseBtn">➕ Record Expense</button>
        <input type="text" id="ieExpenseSearch" placeholder="🔍 Search..." class="search-input" style="max-width:200px;" />
        <select id="ieExpenseCategory" class="filter-select" style="max-width:180px;"><option value="">All Categories</option></select>
        <input type="date" id="ieExpenseFrom" class="search-input" style="max-width:140px;" />
        <input type="date" id="ieExpenseTo" class="search-input" style="max-width:140px;" />
        <button type="button" class="btn btn-sm btn-secondary" id="ieExpenseRefresh">🔄 Refresh</button>
      </div>
      <div style="margin-bottom:0.75rem;display:flex;gap:1rem;flex-wrap:wrap;">
        <span style="font-size:0.85rem;font-weight:600;color:var(--danger);">Total Expenses: <span id="ieExpenseTotal">GH₵ 0.00</span></span>
        <span style="font-size:0.85rem;font-weight:600;color:var(--text-muted);">Records: <span id="ieExpenseCount">0</span></span>
      </div>
      <div class="table-wrapper">
        <table class="app-table">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Method</th><th>Reference</th><th>Action</th></tr></thead>
          <tbody id="ieExpenseBody">
            <tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===== CATEGORIES TAB ===== -->
    <div id="ieTab-categories" class="ie-content" style="display:none;">
      <div class="card-toolbar" style="flex-wrap:wrap;">
        <h3 style="margin:0;">🏷️ Manage Categories</h3>
        <button type="button" class="btn btn-primary" id="ieAddCategoryBtn">➕ Add Category</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem;">
        <div class="acc-card">
          <div class="acc-card-header"><h3>📈 Income Categories</h3></div>
          <div id="ieIncomeCategories" class="ie-category-list"></div>
        </div>
        <div class="acc-card">
          <div class="acc-card-header"><h3>📉 Expense Categories</h3></div>
          <div id="ieExpenseCategories" class="ie-category-list"></div>
        </div>
      </div>
    </div>

    <!-- ===== REPORTS TAB ===== -->
    <div id="ieTab-reports" class="ie-content" style="display:none;">
      <div class="card-toolbar" style="flex-wrap:wrap;">
        <h3 style="margin:0;">📋 Financial Reports</h3>
        <input type="date" id="ieReportFrom" class="search-input" style="max-width:150px;" />
        <input type="date" id="ieReportTo" class="search-input" style="max-width:150px;" />
        <button type="button" class="btn btn-primary" id="ieReportGenerate">📊 Generate Report</button>
        <button type="button" class="btn btn-secondary" id="ieReportPreview">👁️ Preview</button>
        <button type="button" class="btn btn-secondary" id="ieReportPrint">🖨️ Print</button>
      </div>
      <div id="ieReportContent" style="margin-top:1rem;">
        <div style="text-align:center;padding:2rem;color:var(--text-muted);">Select a date range and click "Generate Report" to view financial summary.</div>
      </div>
    </div>
  `;

  // Load categories into all dropdowns
  await _loadCategories();
  _populateCategoryDropdowns();

  // Setup event listeners
  _setupTabListeners();
  _setupDashboardListeners();
  _setupIncomeListeners();
  _setupExpenseListeners();
  _setupCategoryListeners();
  _setupReportListeners();

  // Load dashboard data
  await loadIeDashboard();
}

// ================================================================
// TAB SETUP
// ================================================================

function _setupTabListeners() {
  // Find the most recently created IE container (either admin's or accountant's)
  const containers = document.querySelectorAll('#ieContainer, #accIeContainer');
  if (containers.length === 0) return;
  // Use the last container that has IE tabs rendered
  const container = [...containers].find(c => c.querySelector('.ie-tab')) || containers[0];
  if (!container) return;

  container.querySelectorAll('.ie-tab[data-ie-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.ie-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-ie-tab');
      container.querySelectorAll('.ie-content').forEach(c => c.style.display = 'none');
      const target = getEl(`ieTab-${tab}`);
      if (target) target.style.display = 'block';

      switch (tab) {
        case 'dashboard': await loadIeDashboard(); break;
        case 'income': await _loadIeRecords('income'); break;
        case 'expense': await _loadIeRecords('expense'); break;
        case 'categories': await _renderCategories(); break;
        case 'reports': break;
      }
    });
  });
}

// ================================================================
// DASHBOARD
// ================================================================

function _setupDashboardListeners() {
  getEl('ieDashFilterBtn')?.addEventListener('click', loadIeDashboard);
  getEl('ieDashResetBtn')?.addEventListener('click', () => {
    getEl('ieDashFrom').value = '';
    getEl('ieDashTo').value = '';
    loadIeDashboard();
  });
  getEl('ieDashRefreshBtn')?.addEventListener('click', loadIeDashboard);
}

export async function loadIeDashboard() {
  const schoolId = await _getSchoolId();
  if (!schoolId) return;

  const fromDate = getEl('ieDashFrom')?.value || null;
  const toDate = getEl('ieDashTo')?.value || null;

  try {
    // Load summary
    let summaryQuery = supabaseClient.from('income_expenses')
      .select('type, amount')
      .eq('school_id', schoolId);
    if (fromDate) summaryQuery = summaryQuery.gte('transaction_date', fromDate);
    if (toDate) summaryQuery = summaryQuery.lte('transaction_date', toDate);

    const { data: records } = await summaryQuery;
    if (!records) return;

    let totalIncome = 0, totalExpense = 0;
    records.forEach(r => {
      if (r.type === 'income') totalIncome += Number(r.amount);
      else totalExpense += Number(r.amount);
    });
    const netBalance = totalIncome - totalExpense;

    getEl('ieDashIncome').textContent = `GH₵ ${formatCurrency(totalIncome)}`;
    getEl('ieDashExpense').textContent = `GH₵ ${formatCurrency(totalExpense)}`;
    getEl('ieDashNet').textContent = `GH₵ ${formatCurrency(netBalance)}`;
    getEl('ieDashNet').style.color = netBalance >= 0 ? 'var(--success)' : 'var(--danger)';
    getEl('ieDashCount').textContent = records.length;

    // Load category breakdowns
    await _loadCategoryBreakdown(schoolId, 'income', 'ieDashIncomeBreakdown', fromDate, toDate);
    await _loadCategoryBreakdown(schoolId, 'expense', 'ieDashExpenseBreakdown', fromDate, toDate);

    // Load recent transactions
    await _loadRecentTransactions(schoolId, fromDate, toDate);
  } catch (err) {
    console.error('[IE] Dashboard load error:', err);
  }
}

async function _loadCategoryBreakdown(schoolId, type, containerId, fromDate, toDate) {
  const container = getEl(containerId);
  if (!container) return;

  try {
    // Get categories
    let catQuery = supabaseClient.from('income_expense_categories')
      .select('id, name, icon, color')
      .eq('school_id', schoolId)
      .eq('type', type)
      .order('name');
    const { data: categories } = await catQuery;
    if (!categories || categories.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.85rem;">No categories found.</div>';
      return;
    }

    // Get amounts per category
    const catIds = categories.map(c => c.id);
    let txQuery = supabaseClient.from('income_expenses')
      .select('category_id, amount')
      .eq('school_id', schoolId)
      .eq('type', type)
      .in('category_id', catIds);
    if (fromDate) txQuery = txQuery.gte('transaction_date', fromDate);
    if (toDate) txQuery = txQuery.lte('transaction_date', toDate);
    const { data: transactions } = await txQuery;

    const amountMap = {};
    if (transactions) {
      transactions.forEach(t => {
        amountMap[t.category_id] = (amountMap[t.category_id] || 0) + Number(t.amount);
      });
    }

    const totalAmount = Object.values(amountMap).reduce((s, v) => s + v, 0);

    container.innerHTML = categories.map(c => {
      const amount = amountMap[c.id] || 0;
      const pct = totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;
      return `<div class="ie-breakdown-item">
        <div class="ie-breakdown-header">
          <span>${c.icon || '📌'} ${c.name}</span>
          <span style="font-weight:600;">GH₵ ${formatCurrency(amount)}</span>
        </div>
        <div class="ie-breakdown-track">
          <div class="ie-breakdown-fill" style="width:${pct}%;background:${c.color || '#6366f1'};"></div>
        </div>
        <div class="ie-breakdown-pct" style="font-size:0.72rem;color:var(--text-muted);">${pct}%</div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('[IE] Category breakdown error:', err);
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--danger);font-size:0.85rem;">Error loading breakdown.</div>';
  }
}

async function _loadRecentTransactions(schoolId, fromDate, toDate) {
  const tbody = getEl('ieDashRecentBody');
  if (!tbody) return;

  try {
    let query = supabaseClient.from('income_expenses')
      .select('*, income_expense_categories!inner(name, icon)')
      .eq('school_id', schoolId)
      .order('transaction_date', { ascending: false })
      .limit(20);

    const { data: transactions } = await query;

    if (!transactions || transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--text-muted);">No transactions found.</td></tr>';
      getEl('ieDashRecentCount').textContent = '0';
      return;
    }

    getEl('ieDashRecentCount').textContent = transactions.length;

    tbody.innerHTML = transactions.map(t => {
      const cat = t.income_expense_categories || {};
      const typeIcon = t.type === 'income' ? '📈' : '📉';
      const typeClass = t.type === 'income' ? 'ie-income' : 'ie-expense';
      return `<tr>
        <td>${formatDate(t.transaction_date)}</td>
        <td><span class="${typeClass}" style="font-weight:600;">${typeIcon} ${t.type === 'income' ? 'Income' : 'Expense'}</span></td>
        <td>${cat.icon || ''} ${cat.name || 'Unknown'}</td>
        <td>${t.description || '-'}</td>
        <td style="font-weight:600;color:${t.type === 'income' ? 'var(--success)' : 'var(--danger)'};">GH₵ ${formatCurrency(t.amount)}</td>
        <td>${t.payment_method || '-'}</td>
        <td style="font-size:0.8rem;">-</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('[IE] Recent transactions error:', err);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--danger);">Error loading transactions.</td></tr>';
  }
}

// ================================================================
// INCOME / EXPENSE RECORDS
// ================================================================

function _setupIncomeListeners() {
  getEl('ieAddIncomeBtn')?.addEventListener('click', () => _showIeForm('income'));
  getEl('ieIncomeSearch')?.addEventListener('input', () => _filterIeRecords('income'));
  getEl('ieIncomeCategory')?.addEventListener('change', () => _filterIeRecords('income'));
  getEl('ieIncomeFrom')?.addEventListener('change', () => _filterIeRecords('income'));
  getEl('ieIncomeTo')?.addEventListener('change', () => _filterIeRecords('income'));
  getEl('ieIncomeRefresh')?.addEventListener('click', () => _loadIeRecords('income'));
}

function _setupExpenseListeners() {
  getEl('ieAddExpenseBtn')?.addEventListener('click', () => _showIeForm('expense'));
  getEl('ieExpenseSearch')?.addEventListener('input', () => _filterIeRecords('expense'));
  getEl('ieExpenseCategory')?.addEventListener('change', () => _filterIeRecords('expense'));
  getEl('ieExpenseFrom')?.addEventListener('change', () => _filterIeRecords('expense'));
  getEl('ieExpenseTo')?.addEventListener('change', () => _filterIeRecords('expense'));
  getEl('ieExpenseRefresh')?.addEventListener('click', () => _loadIeRecords('expense'));
}

async function _loadIeRecords(type) {
  const schoolId = await _getSchoolId();
  const tbody = getEl(type === 'income' ? 'ieIncomeBody' : 'ieExpenseBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">Loading...</td></tr>';

  try {
    // Ensure category dropdowns are populated
    if (_categoriesCache.length === 0) {
      await _loadCategories();
    }
    _populateCategoryDropdowns();

    let query = supabaseClient.from('income_expenses')
      .select('*, income_expense_categories!inner(name, icon, color)')
      .eq('school_id', schoolId)
      .eq('type', type)
      .order('transaction_date', { ascending: false });

    const { data: records } = await query;
    _currentIeRecords = records || [];
    _applyIeFilters(type);
  } catch (err) {
    console.error(`[IE] Load ${type} error:`, err);
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--danger);">Error loading records.</td></tr>';
  }
}

function _applyIeFilters(type) {
  const searchEl = getEl(type === 'income' ? 'ieIncomeSearch' : 'ieExpenseSearch');
  const catEl = getEl(type === 'income' ? 'ieIncomeCategory' : 'ieExpenseCategory');
  const fromEl = getEl(type === 'income' ? 'ieIncomeFrom' : 'ieExpenseFrom');
  const toEl = getEl(type === 'income' ? 'ieIncomeTo' : 'ieExpenseTo');
  const tbody = getEl(type === 'income' ? 'ieIncomeBody' : 'ieExpenseBody');
  const totalEl = getEl(type === 'income' ? 'ieIncomeTotal' : 'ieExpenseTotal');
  const countEl = getEl(type === 'income' ? 'ieIncomeCount' : 'ieExpenseCount');

  const search = (searchEl?.value || '').toLowerCase();
  const catId = catEl?.value || '';
  const fromDate = fromEl?.value || '';
  const toDate = toEl?.value || '';

  let filtered = _currentIeRecords.filter(r => {
    if (search) {
      const cat = r.income_expense_categories || {};
      const match = (r.description || '').toLowerCase().includes(search) ||
                    (cat.name || '').toLowerCase().includes(search) ||
                    (r.reference_number || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    if (catId && r.category_id !== catId) return false;
    if (fromDate && r.transaction_date < fromDate) return false;
    if (toDate && r.transaction_date > toDate) return false;
    return true;
  });

  _ieFilteredRecords = filtered;

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);
  if (totalEl) totalEl.textContent = `GH₵ ${formatCurrency(total)}`;
  if (countEl) countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted);">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const cat = r.income_expense_categories || {};
    return `<tr>
      <td>${formatDate(r.transaction_date)}</td>
      <td>${cat.icon || ''} ${cat.name || 'Unknown'}</td>
      <td>${r.description || '-'}</td>
      <td style="font-weight:600;color:${type === 'income' ? 'var(--success)' : 'var(--danger)'};">GH₵ ${formatCurrency(r.amount)}</td>
      <td>${r.payment_method || '-'}</td>
      <td>${r.reference_number || '-'}</td>
      <td>
        <button class="action-btn" onclick="ieEditRecord('${r.id}')" title="Edit">✏️</button>
        <button class="action-btn" style="color:var(--danger);" onclick="ieDeleteRecord('${r.id}')" title="Delete">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

// ================================================================
// ADD / EDIT RECORD FORM
// ================================================================

function _showIeForm(type, editRecord = null) {
  const isEdit = !!editRecord;
  const title = isEdit ? `✏️ Edit ${type === 'income' ? 'Income' : 'Expense'} Record` : `➕ Record New ${type === 'income' ? 'Income' : 'Expense'}`;

  // Get categories for this type
  const categories = _categoriesCache.filter(c => c.type === type);

  let catOptions = '<option value="">— Select Category —</option>';
  categories.forEach(c => {
    const selected = editRecord && editRecord.category_id === c.id ? 'selected' : '';
    catOptions += `<option value="${c.id}" ${selected}>${c.icon || '📌'} ${c.name}</option>`;
  });

  const modalHtml = `
    <div class="modal-overlay" id="ieFormModal" style="display:flex;">
      <div class="modal-card" style="max-width:520px;max-height:90vh;overflow-y:auto;">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeIeFormModal()">✖</button>
        </div>
        <div class="modal-body" style="padding:1.5rem;">
          <form id="ieForm">
            <input type="hidden" id="ieFormId" value="${editRecord ? editRecord.id : ''}" />
            <input type="hidden" id="ieFormType" value="${type}" />
            <div class="form-row">
              <div class="form-group">
                <label>Category *</label>
                <select id="ieFormCategory" required>${catOptions}</select>
              </div>
              <div class="form-group">
                <label>Amount (GH₵) *</label>
                <input type="number" id="ieFormAmount" step="0.01" min="0.01" required value="${editRecord ? editRecord.amount : ''}" placeholder="e.g. 500.00" />
              </div>
            </div>
            <div class="form-group">
              <label>Description *</label>
              <input type="text" id="ieFormDescription" required value="${editRecord ? editRecord.description : ''}" placeholder="Brief description of this transaction" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Date *</label>
                <input type="date" id="ieFormDate" required value="${editRecord ? editRecord.transaction_date : new Date().toISOString().split('T')[0]}" />
              </div>
              <div class="form-group">
                <label>Payment Method</label>
                <select id="ieFormMethod">
                  <option value="cash" ${editRecord && editRecord.payment_method === 'cash' ? 'selected' : ''}>Cash</option>
                  <option value="mobile_money" ${editRecord && editRecord.payment_method === 'mobile_money' ? 'selected' : ''}>Mobile Money</option>
                  <option value="bank_transfer" ${editRecord && editRecord.payment_method === 'bank_transfer' ? 'selected' : ''}>Bank Transfer</option>
                  <option value="cheque" ${editRecord && editRecord.payment_method === 'cheque' ? 'selected' : ''}>Cheque</option>
                  <option value="other" ${editRecord && editRecord.payment_method === 'other' ? 'selected' : ''}>Other</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Reference Number</label>
                <input type="text" id="ieFormRef" value="${editRecord ? editRecord.reference_number || '' : ''}" placeholder="Optional ref number" />
              </div>
              <div class="form-group">
                <label>Receipt Number</label>
                <input type="text" id="ieFormReceipt" value="${editRecord ? editRecord.receipt_number || '' : ''}" placeholder="Optional receipt #" />
              </div>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea id="ieFormNotes" rows="2" placeholder="Optional notes">${editRecord ? editRecord.notes || '' : ''}</textarea>
            </div>
            <div id="ieFormMessage" class="message" style="display:none;"></div>
            <button type="submit" class="btn btn-primary btn-full" id="ieFormSubmitBtn">${isEdit ? '💾 Update Record' : '💾 Save Record'}</button>
          </form>
        </div>
      </div>
    </div>
  `;

  // Append modal to body
  const modalContainer = document.createElement('div');
  modalContainer.id = 'ieFormModalContainer';
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  // Setup form submit
  getEl('ieForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _saveIeRecord();
  });
}

// Expose close function globally
window.closeIeFormModal = function() {
  const container = getEl('ieFormModalContainer');
  if (container) container.remove();
};

async function _saveIeRecord() {
  clearMessage('ieFormMessage');
  const btn = getEl('ieFormSubmitBtn');
  setLoading(btn, true, 'Saving...');

  try {
    const schoolId = await _getSchoolId();
    const { data: { user } } = await supabaseClient.auth.getUser();

    const id = getEl('ieFormId').value;
    const type = getEl('ieFormType').value;
    const categoryId = getEl('ieFormCategory').value;
    const amount = parseFloat(getEl('ieFormAmount').value);
    const description = getEl('ieFormDescription').value.trim();
    const date = getEl('ieFormDate').value;
    const method = getEl('ieFormMethod').value;
    const ref = getEl('ieFormRef').value.trim() || null;
    const receipt = getEl('ieFormReceipt').value.trim() || null;
    const notes = getEl('ieFormNotes').value.trim() || null;

    if (!categoryId) { showMessage('ieFormMessage', 'Please select a category.', 'error'); setLoading(btn, false, 'Save Record'); return; }
    if (!amount || amount <= 0) { showMessage('ieFormMessage', 'Please enter a valid amount.', 'error'); setLoading(btn, false, 'Save Record'); return; }
    if (!description) { showMessage('ieFormMessage', 'Please enter a description.', 'error'); setLoading(btn, false, 'Save Record'); return; }
    if (!date) { showMessage('ieFormMessage', 'Please select a date.', 'error'); setLoading(btn, false, 'Save Record'); return; }

    if (id) {
      // Update existing record
      const { error } = await supabaseClient.from('income_expenses')
        .update({
          category_id: categoryId,
          amount: amount,
          description: description,
          transaction_date: date,
          payment_method: method,
          reference_number: ref,
          receipt_number: receipt,
          notes: notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('school_id', schoolId);

      if (error) throw error;
      showMessage('ieFormMessage', '✅ Record updated successfully!', 'success');
    } else {
      // Create new record
      const { error } = await supabaseClient.from('income_expenses')
        .insert([{
          type: type,
          category_id: categoryId,
          amount: amount,
          description: description,
          transaction_date: date,
          payment_method: method,
          reference_number: ref,
          receipt_number: receipt,
          notes: notes,
          recorded_by: user?.id || null,
          school_id: schoolId,
        }]);

      if (error) throw error;
      showMessage('ieFormMessage', '✅ Record saved successfully!', 'success');
    }

    // Close modal after short delay
    setTimeout(() => {
      window.closeIeFormModal();
      // Refresh the current tab
      if (type === 'income') _loadIeRecords('income');
      else _loadIeRecords('expense');
      loadIeDashboard();
    }, 1000);
  } catch (err) {
    showMessage('ieFormMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, 'Save Record');
  }
}

// Expose edit/delete globally for inline onclick
window.ieEditRecord = async function(id) {
  try {
    const { data } = await supabaseClient.from('income_expenses')
      .select('*')
      .eq('id', id)
      .single();
    if (data) {
      _showIeForm(data.type, data);
    }
  } catch (err) {
    alert('Error loading record: ' + err.message);
  }
};

window.ieDeleteRecord = async function(id) {
  if (!confirm('⚠️ Are you sure you want to delete this record? This action cannot be undone.')) return;

  try {
    const { error } = await supabaseClient.from('income_expenses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Refresh the current view
    const activeTab = document.querySelector('.ie-tab.active');
    const tab = activeTab?.getAttribute('data-ie-tab');
    if (tab === 'income') _loadIeRecords('income');
    else if (tab === 'expense') _loadIeRecords('expense');
    loadIeDashboard();
  } catch (err) {
    alert('Error deleting record: ' + err.message);
  }
};

// ================================================================
// CATEGORY MANAGEMENT
// ================================================================

function _setupCategoryListeners() {
  getEl('ieAddCategoryBtn')?.addEventListener('click', () => _showCategoryForm());
}

async function _renderCategories() {
  const schoolId = await _getSchoolId();
  await _loadCategories();
  _populateCategoryDropdowns();

  const incomeCats = _categoriesCache.filter(c => c.type === 'income');
  const expenseCats = _categoriesCache.filter(c => c.type === 'expense');

  _renderCategoryList('ieIncomeCategories', incomeCats);
  _renderCategoryList('ieExpenseCategories', expenseCats);
}

function _renderCategoryList(containerId, categories) {
  const container = getEl(containerId);
  if (!container) return;

  if (categories.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.85rem;">No categories found.</div>';
    return;
  }

  container.innerHTML = categories.map(c => `
    <div class="ie-category-item" style="border-left:4px solid ${c.color || '#6366f1'};">
      <div class="ie-category-info">
        <span class="ie-category-icon">${c.icon || '📌'}</span>
        <div>
          <div class="ie-category-name">${c.name}</div>
          <div class="ie-category-desc">${c.description || '-'}</div>
        </div>
      </div>
      <div class="ie-category-actions">
        <button class="action-btn" onclick="ieEditCategory('${c.id}')" title="Edit">✏️</button>
        <button class="action-btn" style="color:var(--danger);" onclick="ieDeleteCategory('${c.id}')" title="Delete">🗑️</button>
      </div>
    </div>
  `).join('');
}

function _showCategoryForm(editCategory = null) {
  const isEdit = !!editCategory;
  const title = isEdit ? `✏️ Edit Category` : `➕ Add New Category`;

  const modalHtml = `
    <div class="modal-overlay" id="ieCategoryFormModal" style="display:flex;">
      <div class="modal-card" style="max-width:480px;">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeIeCategoryFormModal()">✖</button>
        </div>
        <div class="modal-body" style="padding:1.5rem;">
          <form id="ieCategoryForm">
            <input type="hidden" id="ieCategoryFormId" value="${editCategory ? editCategory.id : ''}" />
            <div class="form-row">
              <div class="form-group">
                <label>Category Name *</label>
                <input type="text" id="ieCategoryFormName" required value="${editCategory ? editCategory.name : ''}" placeholder="e.g. School Fees" />
              </div>
              <div class="form-group">
                <label>Type *</label>
                <select id="ieCategoryFormType" required ${isEdit ? 'disabled' : ''}>
                  <option value="income" ${editCategory && editCategory.type === 'income' ? 'selected' : ''}>📈 Income</option>
                  <option value="expense" ${editCategory && editCategory.type === 'expense' ? 'selected' : ''}>📉 Expense</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Icon (emoji)</label>
                <input type="text" id="ieCategoryFormIcon" value="${editCategory ? editCategory.icon || '' : ''}" placeholder="e.g. 💰" maxlength="10" />
              </div>
              <div class="form-group">
                <label>Color (hex)</label>
                <input type="color" id="ieCategoryFormColor" value="${editCategory ? editCategory.color || '#6366f1' : '#6366f1'}" style="height:40px;padding:2px;" />
              </div>
            </div>
            <div class="form-group">
              <label>Description</label>
              <input type="text" id="ieCategoryFormDesc" value="${editCategory ? editCategory.description || '' : ''}" placeholder="Optional description" />
            </div>
            <div id="ieCategoryFormMessage" class="message" style="display:none;"></div>
            <button type="submit" class="btn btn-primary btn-full" id="ieCategoryFormSubmitBtn">${isEdit ? '💾 Update Category' : '💾 Save Category'}</button>
          </form>
        </div>
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.id = 'ieCategoryFormModalContainer';
  container.innerHTML = modalHtml;
  document.body.appendChild(container);

  getEl('ieCategoryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await _saveCategory();
  });
}

window.closeIeCategoryFormModal = function() {
  const container = getEl('ieCategoryFormModalContainer');
  if (container) container.remove();
};

async function _saveCategory() {
  clearMessage('ieCategoryFormMessage');
  const btn = getEl('ieCategoryFormSubmitBtn');
  setLoading(btn, true, 'Saving...');

  try {
    const schoolId = await _getSchoolId();
    const id = getEl('ieCategoryFormId').value;
    const name = getEl('ieCategoryFormName').value.trim();
    const type = getEl('ieCategoryFormType').value;
    const icon = getEl('ieCategoryFormIcon').value.trim() || '📌';
    const color = getEl('ieCategoryFormColor').value || '#6366f1';
    const description = getEl('ieCategoryFormDesc').value.trim() || null;

    if (!name) { showMessage('ieCategoryFormMessage', 'Please enter a category name.', 'error'); setLoading(btn, false, 'Save Category'); return; }

    if (id) {
      const { error } = await supabaseClient.from('income_expense_categories')
        .update({ name, icon, color, description })
        .eq('id', id)
        .eq('school_id', schoolId);

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505') {
          showMessage('ieCategoryFormMessage', '❌ A category with this name already exists.', 'error');
        } else {
          throw error;
        }
        setLoading(btn, false, 'Save Category');
        return;
      }
    } else {
      const { error } = await supabaseClient.from('income_expense_categories')
        .insert([{ name, type, icon, color, description, school_id: schoolId }]);

      if (error) {
        if (error.message?.includes('duplicate') || error.code === '23505') {
          showMessage('ieCategoryFormMessage', '❌ A category with this name already exists.', 'error');
        } else {
          throw error;
        }
        setLoading(btn, false, 'Save Category');
        return;
      }
    }

    showMessage('ieCategoryFormMessage', '✅ Category saved successfully!', 'success');
    setTimeout(() => {
      window.closeIeCategoryFormModal();
      _loadCategories();
      _renderCategories();
      _populateCategoryDropdowns();
    }, 1000);
  } catch (err) {
    showMessage('ieCategoryFormMessage', 'Error: ' + err.message, 'error');
  } finally {
    setLoading(btn, false, 'Save Category');
  }
}

window.ieEditCategory = async function(id) {
  const cat = _categoriesCache.find(c => c.id === id);
  if (cat) _showCategoryForm(cat);
};

window.ieDeleteCategory = async function(id) {
  if (!confirm('⚠️ Delete this category? Records using this category will not be deleted, but the category will be removed.')) return;

  try {
    const { error } = await supabaseClient.from('income_expense_categories')
      .delete()
      .eq('id', id);

    if (error) {
      if (error.message?.includes('foreign key') || error.code === '23503') {
        alert('❌ Cannot delete this category because it has associated records. Please reassign or delete those records first.');
      } else {
        throw error;
      }
      return;
    }

    await _loadCategories();
    await _renderCategories();
    _populateCategoryDropdowns();
  } catch (err) {
    alert('Error deleting category: ' + err.message);
  }
};

// ================================================================
// REPORTS
// ================================================================

function _setupReportListeners() {
  getEl('ieReportGenerate')?.addEventListener('click', _generateReport);
  getEl('ieReportPreview')?.addEventListener('click', _previewReport);
  getEl('ieReportPrint')?.addEventListener('click', _printReport);
}

async function _generateReport() {
  const schoolId = await _getSchoolId();
  const fromDate = getEl('ieReportFrom')?.value || '';
  const toDate = getEl('ieReportTo')?.value || '';
  const container = getEl('ieReportContent');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">Generating report...</div>';

  try {
    // Get school name
    let schoolName = 'School';
    const { data: school } = await supabaseClient.from('schools').select('name').eq('id', schoolId).single();
    if (school?.name) schoolName = school.name;

    // Get summary
    let query = supabaseClient.from('income_expenses')
      .select('type, amount, category_id, description, transaction_date, payment_method, reference_number, notes, income_expense_categories!inner(name, icon, color)')
      .eq('school_id', schoolId)
      .order('transaction_date', { ascending: false });

    if (fromDate) query = query.gte('transaction_date', fromDate);
    if (toDate) query = query.lte('transaction_date', toDate);

    const { data: records } = await query;

    if (!records || records.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No records found for the selected date range.</div>';
      return;
    }

    let totalIncome = 0, totalExpense = 0;
    records.forEach(r => {
      if (r.type === 'income') totalIncome += Number(r.amount);
      else totalExpense += Number(r.amount);
    });
    const netBalance = totalIncome - totalExpense;

    const dateRangeStr = fromDate || toDate
      ? `${fromDate || 'Start'} to ${toDate || 'End'}`
      : 'All Time';

    let html = `
      <div class="ie-report">
        <div style="text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:1rem;margin-bottom:1rem;">
          <h2 style="margin:0;color:#1e3a5f;">${schoolName}</h2>
          <h3 style="margin:0.5rem 0;font-size:1.1rem;">📊 Financial Report</h3>
          <p style="margin:0;font-size:0.85rem;color:var(--text-muted);">Period: ${dateRangeStr}</p>
          <p style="margin:0;font-size:0.85rem;color:var(--text-muted);">Generated: ${new Date().toLocaleString()}</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1rem;">
          <div style="padding:1rem;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;text-align:center;">
            <div style="font-size:0.85rem;color:#166534;">Total Income</div>
            <div style="font-size:1.5rem;font-weight:700;color:#166534;">GH₵ ${formatCurrency(totalIncome)}</div>
          </div>
          <div style="padding:1rem;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;text-align:center;">
            <div style="font-size:0.85rem;color:#991b1b;">Total Expenses</div>
            <div style="font-size:1.5rem;font-weight:700;color:#991b1b;">GH₵ ${formatCurrency(totalExpense)}</div>
          </div>
          <div style="padding:1rem;background:${netBalance >= 0 ? '#f0fdf4' : '#fef2f2'};border-radius:8px;border:1px solid ${netBalance >= 0 ? '#bbf7d0' : '#fecaca'};text-align:center;">
            <div style="font-size:0.85rem;color:${netBalance >= 0 ? '#166534' : '#991b1b'};">Net Balance</div>
            <div style="font-size:1.5rem;font-weight:700;color:${netBalance >= 0 ? '#166534' : '#991b1b'};">GH₵ ${formatCurrency(netBalance)}</div>
          </div>
        </div>

        <div class="table-wrapper">
          <table class="app-table" style="font-size:0.85rem;">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Type</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount (GH₵)</th>
                <th>Method</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              ${records.map((r, i) => {
                const cat = r.income_expense_categories || {};
                const typeLabel = r.type === 'income' ? '📈 Income' : '📉 Expense';
                return `<tr>
                  <td>${i + 1}</td>
                  <td>${formatDate(r.transaction_date)}</td>
                  <td><span style="color:${r.type === 'income' ? 'var(--success)' : 'var(--danger)'};">${typeLabel}</span></td>
                  <td>${cat.icon || ''} ${cat.name || 'Unknown'}</td>
                  <td>${r.description || '-'}</td>
                  <td style="font-weight:600;text-align:right;color:${r.type === 'income' ? 'var(--success)' : 'var(--danger)'};">${formatCurrency(r.amount)}</td>
                  <td>${r.payment_method || '-'}</td>
                  <td>${r.reference_number || '-'}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background:#1e3a5f;color:#fff;font-weight:bold;">
                <td colspan="5" style="padding:8px;text-align:right;">TOTAL INCOME / EXPENSE</td>
                <td style="padding:8px;text-align:right;">GH₵ ${formatCurrency(totalIncome)} / GH₵ ${formatCurrency(totalExpense)}</td>
                <td colspan="2"></td>
              </tr>
              <tr style="background:${netBalance >= 0 ? '#166534' : '#991b1b'};color:#fff;font-weight:bold;">
                <td colspan="5" style="padding:8px;text-align:right;">NET BALANCE</td>
                <td style="padding:8px;text-align:right;">GH₵ ${formatCurrency(netBalance)}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p style="text-align:center;font-size:0.75rem;color:var(--text-muted);margin-top:1rem;">${records.length} transaction(s) · ${dateRangeStr}</p>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    console.error('[IE] Report generation error:', err);
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--danger);">Error generating report.</div>';
  }
}

async function _previewReport() {
  const content = getEl('ieReportContent');
  if (!content || !content.querySelector('.ie-report')) {
    await _generateReport();
  }

  const reportHtml = content.innerHTML;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'ieReportPreviewModal';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-card" style="max-width:900px;max-height:90vh;overflow-y:auto;">
      <div class="modal-header">
        <h3>👁️ Report Preview</h3>
        <button class="modal-close" onclick="document.getElementById('ieReportPreviewModal').style.display='none';document.getElementById('ieReportPreviewModal').remove();">✖</button>
      </div>
      <div class="modal-body">${reportHtml}</div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function _printReport() {
  const content = getEl('ieReportContent');
  if (!content || !content.querySelector('.ie-report')) {
    await _generateReport();
  }

  const reportHtml = content.innerHTML;
  openPrintWindow(`
    <html><head>
      <title>Financial Report</title>
      <style>
        @media print { body { margin: 0; padding: 10px; } table { page-break-inside: auto; } tr { page-break-inside: avoid; page-break-after: auto; } thead { display: table-header-group; } tfoot { display: table-footer-group; } }
        body { font-family: Arial, sans-serif; padding: 20px; }
        .app-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .app-table th { background: #1e3a5f; color: #fff; padding: 8px 6px; border: 1px solid #333; text-align: left; }
        .app-table td { padding: 6px; border: 1px solid #ddd; }
        .app-table tr:nth-child(even) { background: #f8f9fa; }
        .action-btn { display: none; }
        .ie-report { max-width: 100%; }
      </style>
    </head><body>${reportHtml}</body></html>
  `, 'Financial Report', 900, 700);
}

// ================================================================
// HELPERS
// ================================================================

async function _getSchoolId() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;

    const { data: prof } = await supabaseClient.from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .maybeSingle();

    if (prof?.school_id) return prof.school_id;

    // Fallback for accountants
    const { data: acc } = await supabaseClient.from('accountants')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle();

    return acc?.school_id || null;
  } catch (err) {
    console.error('[IE] getSchoolId error:', err);
    return null;
  }
}

async function _loadCategories() {
  const schoolId = await _getSchoolId();
  if (!schoolId) return;

  try {
    let query = supabaseClient.from('income_expense_categories')
      .select('*')
      .eq('school_id', schoolId)
      .order('type')
      .order('name');

    const { data } = await query;
    _categoriesCache = data || [];
  } catch (err) {
    console.error('[IE] Load categories error:', err);
    _categoriesCache = [];
  }
}

function _populateCategoryDropdowns() {
  const incomeCats = _categoriesCache.filter(c => c.type === 'income');
  const expenseCats = _categoriesCache.filter(c => c.type === 'expense');

  _populateSelect('ieIncomeCategory', incomeCats);
  _populateSelect('ieExpenseCategory', expenseCats);
}

function _populateSelect(elId, categories) {
  const el = getEl(elId);
  if (!el) return;
  const currentValue = el.value;
  el.innerHTML = '<option value="">All Categories</option>' +
    categories.map(c => `<option value="${c.id}" ${c.id === currentValue ? 'selected' : ''}>${c.icon || '📌'} ${c.name}</option>`).join('');
}