import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Receipt, 
  ArrowRight,
  Plus,
  Tag,
  Calendar,
  Pencil,
  Trash2,
  Loader2,
  X,
  UserPlus,
  Mail,
  FileUp,
  ChevronDown,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Group, Expense, HouseholdMember } from '../types';
import { useCategories } from '../contexts/CategoriesContext';
import { AppUser } from '../types';
import { formatCurrency, formatDateShort, CURRENCY_SYMBOL } from '../utils/format';
import { handleDbError, OperationType } from '../utils/errorHandling';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteExpense,
  subscribeToGroupExpenses,
  updateExpense,
} from '../lib/budgetDb';
import { dateToIso, toDate } from '../lib/dates';
import {
  inviteHouseholdMember,
  removeHouseholdMember,
  subscribeToHouseholdMembers,
} from '../lib/household';
import ExpenseImportModal from './ExpenseImportModal';

interface DashboardProps {
  user: AppUser;
  groups: Group[];
  onSelectGroup: (id: string) => void;
  theme: 'light' | 'dark';
}

interface Alert {
  id: string;
  message: string;
  type: 'warning' | 'info';
  groupId: string;
}

interface DashboardExpense extends Expense {
  groupId: string;
}

function getGroupScheduledSpend(group: Group): number {
  return (
    (group.installments?.reduce((sum, i) => sum + i.amount, 0) ?? 0) +
    (group.creditPayments?.reduce((sum, c) => sum + c.amount, 0) ?? 0) +
    (group.insurancePayments?.reduce((sum, ip) => sum + ip.amount, 0) ?? 0) +
    (group.shoppingTrips?.reduce((sum, t) => sum + t.totalAmount, 0) ?? 0)
  );
}

export default function Dashboard({ user, groups, onSelectGroup, theme }: DashboardProps) {
  const { accessToken } = useAuth();
  const { categories, categoryNames } = useCategories();
  const [recentExpenses, setRecentExpenses] = useState<DashboardExpense[]>([]);
  const [allExpenses, setAllExpenses] = useState<DashboardExpense[]>([]);
  const [isGroupsListOpen, setIsGroupsListOpen] = useState(false);
  
  // Edit/Delete states
  const [editingExpense, setEditingExpense] = useState<DashboardExpense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<DashboardExpense | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [isHouseholdOpen, setIsHouseholdOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const groupsListModalRef = React.useRef<HTMLDivElement>(null);
  const householdModalRef = React.useRef<HTMLDivElement>(null);
  const deleteExpenseModalRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isGroupsListOpen && groupsListModalRef.current) {
      groupsListModalRef.current.focus();
    }
  }, [isGroupsListOpen]);

  useEffect(() => {
    if (expenseToDelete && deleteExpenseModalRef.current) {
      deleteExpenseModalRef.current.focus();
    }
  }, [expenseToDelete]);

  useEffect(() => {
    if (isHouseholdOpen && householdModalRef.current) {
      householdModalRef.current.focus();
    }
  }, [isHouseholdOpen]);

  // Form states for editing
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDate, setEditDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (categoryNames.length && !editCategory) {
      setEditCategory(categoryNames[0]);
    }
  }, [categoryNames, editCategory]);

  useEffect(() => {
    if (editingExpense) {
      setEditAmount(editingExpense.amount.toString());
      setEditDescription(editingExpense.description);
      setEditCategory(editingExpense.category);
      setEditDate(toDate(editingExpense.date).toISOString().split('T')[0]);
    }
  }, [editingExpense]);

  useEffect(() => {
    if (!accessToken) {
      setHouseholdMembers([]);
      return;
    }
    return subscribeToHouseholdMembers(setHouseholdMembers, (error) => {
      console.error('Error fetching household members:', error);
    });
  }, [accessToken]);

  const handleInviteHouseholdMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !accessToken) return;

    setInviteLoading(true);
    setInviteError(null);
    try {
      await inviteHouseholdMember(email);
      setInviteSuccess(true);
      setInviteEmail('');
      setTimeout(() => setInviteSuccess(false), 2500);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite person');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveHouseholdMember = async (memberUserId: string) => {
    if (!accessToken || memberUserId === user.uid) return;
    setRemovingUserId(memberUserId);
    try {
      await removeHouseholdMember(memberUserId);
    } catch (err) {
      console.error('Failed to remove household member:', err);
    } finally {
      setRemovingUserId(null);
    }
  };

  const currentMember = householdMembers.find((m) => m.userId === user.uid);
  const isHouseholdAdmin = currentMember?.role === 'admin';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditingExpense(null);
        setExpenseToDelete(null);
        setIsGroupsListOpen(false);
        setIsHouseholdOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpdateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense || !accessToken) return;

    setIsSaving(true);
    try {
      await updateExpense(editingExpense.id, {
        amount: parseFloat(editAmount),
        description: editDescription,
        category: editCategory,
        date: dateToIso(new Date(editDate)),
      });
      setEditingExpense(null);
    } catch (error) {
      handleDbError(error, OperationType.UPDATE, `expenses/${editingExpense.id}`, user.uid);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteExpense = async () => {
    if (!expenseToDelete || !accessToken) return;

    setIsDeleting(true);
    try {
      await deleteExpense(expenseToDelete.id);
      setExpenseToDelete(null);
    } catch (error) {
      handleDbError(error, OperationType.DELETE, `expenses/${expenseToDelete.id}`, user.uid);
    } finally {
      setIsDeleting(false);
    }
  };

  const groupsRef = React.useRef(groups);
  groupsRef.current = groups;

  const groupIdsKey = React.useMemo(
    () =>
      groups
        .map((g) => `${g.id}:${g.maxBudget ?? ''}`)
        .sort()
        .join('|'),
    [groups],
  );

  useEffect(() => {
    if (groups.length === 0) {
      setRecentExpenses([]);
      setAllExpenses([]);
      return;
    }

    const expensesMap = new Map<string, DashboardExpense[]>();
    let cancelled = false;

    const recompute = () => {
      if (cancelled) return;

      const flat = Array.from(expensesMap.values()).flat();
      flat.sort(
        (a, b) => toDate(b.date).getTime() - toDate(a.date).getTime(),
      );
      setAllExpenses(flat);
      setRecentExpenses(flat.slice(0, 10));
    };

    const unsubscribes = groupsRef.current.map((group) =>
      subscribeToGroupExpenses(
        group.id,
        (fetchedExpenses) => {
          expensesMap.set(
            group.id,
            fetchedExpenses.map((e) => ({ ...e, groupId: group.id })),
          );
          recompute();
        },
        (error) => {
          console.error('Error fetching expenses for group', group.id, error);
        },
      ),
    );

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [groupIdsKey]);

  const alerts = React.useMemo(() => {
    const newAlerts: Alert[] = [];
    groups.forEach((g) => {
      if (!g.maxBudget) return;

      const expenseSpent = allExpenses
        .filter((e) => e.groupId === g.id)
        .filter((e) => {
          const d = toDate(e.date);
          return d.getMonth() + 1 === g.month && d.getFullYear() === g.year;
        })
        .reduce((sum, e) => sum + e.amount, 0);

      const totalSpent = expenseSpent + getGroupScheduledSpend(g);
      const ratio = totalSpent / g.maxBudget;

      if (ratio > 1) {
        newAlerts.push({
          id: `over-budget-${g.id}`,
          message: `"${g.name}" is over budget (${formatCurrency(totalSpent)} / ${formatCurrency(g.maxBudget)})`,
          type: 'warning',
          groupId: g.id,
        });
      } else if (ratio >= 0.85) {
        newAlerts.push({
          id: `near-budget-${g.id}`,
          message: `"${g.name}" is at ${(ratio * 100).toFixed(0)}% of budget (${formatCurrency(totalSpent)} / ${formatCurrency(g.maxBudget)})`,
          type: 'info',
          groupId: g.id,
        });
      }
    });
    return newAlerts;
  }, [allExpenses, groups]);

  const monthsWithBudget = groups.filter((g) => g.maxBudget != null && g.maxBudget > 0);

  const categorySpending = React.useMemo(() => {
    const map = new Map<string, number>();
    allExpenses.forEach((e) => {
      map.set(e.category, (map.get(e.category) || 0) + e.amount);
    });

    let productsTotal = 0;
    let loansTotal = 0;
    let insuranceTotal = 0;
    groups.forEach((g) => {
      productsTotal +=
        (g.installments?.reduce((sum, i) => sum + i.amount, 0) ?? 0) +
        (g.shoppingTrips?.reduce((sum, t) => sum + t.totalAmount, 0) ?? 0);
      loansTotal +=
        g.creditPayments?.reduce((sum, c) => sum + c.amount, 0) ?? 0;
      insuranceTotal +=
        g.insurancePayments?.reduce((sum, ip) => sum + ip.amount, 0) ?? 0;
    });

    if (productsTotal > 0) {
      map.set('Products', (map.get('Products') || 0) + productsTotal);
    }
    if (loansTotal > 0) {
      map.set('Loans', (map.get('Loans') || 0) + loansTotal);
    }
    if (insuranceTotal > 0) {
      map.set('Insurance', (map.get('Insurance') || 0) + insuranceTotal);
    }

    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    return Array.from(map.entries())
      .map(([name, amount]) => ({
        name,
        amount,
        share: total > 0 ? (amount / total) * 100 : 0,
        priority: categories.find((c) => c.name === name)?.priority ?? 99,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [allExpenses, groups, categories]);

  const monthSpending = React.useMemo(() => {
    return groups
      .map((g) => {
        const expenseAmount = allExpenses
          .filter((e) => e.groupId === g.id)
          .reduce((sum, e) => sum + e.amount, 0);
        const amount = expenseAmount + getGroupScheduledSpend(g);
        return {
          name: g.name,
          amount,
          groupId: g.id,
          month: g.month,
          year: g.year,
        };
      })
      .sort((a, b) => b.year - a.year || b.month - a.month);
  }, [allExpenses, groups]);

  const monthSpendingByYear = React.useMemo(() => {
    const map = new Map<number, typeof monthSpending>();
    for (const m of monthSpending) {
      if (!map.has(m.year)) map.set(m.year, []);
      map.get(m.year)!.push(m);
    }
    return [...map.entries()].sort(([a], [b]) => b - a);
  }, [monthSpending]);

  const currentYear = new Date().getFullYear();
  const [expandedSpendingYears, setExpandedSpendingYears] = useState<Set<number>>(
    () => new Set([currentYear]),
  );

  const toggleSpendingYear = (year: number) => {
    setExpandedSpendingYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const CHART_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6'];
  const chartTickFill = theme === 'dark' ? '#a1a1aa' : '#71717a';

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">
            Welcome back, <span className="text-indigo-600 dark:text-indigo-400">{user.displayName?.split(' ')[0]}</span>
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 font-medium text-lg">Here's what's happening with your shared budgets today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 px-5 py-3 border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 rounded-2xl text-sm font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all active:scale-95"
          >
            <FileUp className="w-4 h-4" />
            Import PDF
          </button>
          <button
            type="button"
            onClick={() => setIsHouseholdOpen(true)}
            className="flex items-center gap-2 px-5 py-3 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 rounded-2xl text-sm font-bold hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all active:scale-95"
          >
            <Users className="w-4 h-4" />
            Household
            {householdMembers.length > 1 && (
              <span className="px-2 py-0.5 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs">
                {householdMembers.length}
              </span>
            )}
          </button>
          <button 
            onClick={() => (window as any).openCreateGroupModal?.()}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-500/40 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Create New Month
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <button 
          onClick={() => {
            if (groups.length === 0) return;
            if (groups.length === 1) {
              onSelectGroup(groups[0].id);
            } else {
              setIsGroupsListOpen(true);
            }
          }}
          className={`text-left bg-indigo-600 p-8 rounded-[32px] shadow-lg shadow-indigo-500/40 relative overflow-hidden group transition-all ${groups.length > 0 ? 'hover:scale-[1.02] active:scale-95 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
              <Users className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs font-bold text-indigo-100 uppercase tracking-[0.2em] mb-1">Active Months</p>
            <p className="text-4xl font-bold text-white font-display tracking-tight">{groups.length}</p>
          </div>
        </button>

        <button 
          onClick={() => {
            if (recentExpenses.length === 0) return;
            onSelectGroup(recentExpenses[0].groupId);
          }}
          className={`text-left bg-emerald-600 p-8 rounded-[32px] shadow-lg shadow-emerald-500/40 relative overflow-hidden group transition-all ${recentExpenses.length > 0 ? 'hover:scale-[1.02] active:scale-95 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
              <Receipt className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs font-bold text-emerald-100 uppercase tracking-[0.2em] mb-1">Recent Expenses</p>
            <p className="text-4xl font-bold text-white font-display tracking-tight">{recentExpenses.length}</p>
          </div>
        </button>

        <button 
          onClick={() => {
            if (alerts.length === 0) return;
            onSelectGroup(alerts[0].groupId);
          }}
          className={`text-left bg-fuchsia-600 p-8 rounded-[32px] shadow-lg shadow-fuchsia-500/40 relative overflow-hidden group transition-all ${alerts.length > 0 ? 'hover:scale-[1.02] active:scale-95 cursor-pointer' : 'cursor-default'}`}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <p className="text-xs font-bold text-fuchsia-100 uppercase tracking-[0.2em] mb-1">Active Alerts</p>
            <p className="text-4xl font-bold text-white font-display tracking-tight">{alerts.length}</p>
          </div>
        </button>
      </div>

      {groups.length > 0 && (
        <section className="mb-12 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-zinc-900 p-6 sm:p-8 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 font-display flex items-center gap-2">
              <Tag className="w-5 h-5 text-indigo-600" />
              Spending by category
            </h2>
            <p className="text-sm text-zinc-500 mb-6">Where you spend more vs less (all months)</p>
            {categorySpending.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-8">No expenses yet</p>
            ) : (
              <>
                <div className="h-[220px] w-full mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categorySpending} layout="vertical" margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" opacity={0.3} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: chartTickFill }} tickFormatter={(v) => formatCurrency(v)} />
                      <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 10, fill: chartTickFill }} />
                      <Tooltip
                        cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const name = String(label ?? payload[0].payload?.name ?? '');
                          const value = Number(payload[0].value ?? 0);
                          const index = categorySpending.findIndex((c) => c.name === name);
                          const barColor =
                            CHART_COLORS[
                              (index >= 0 ? index : 0) % CHART_COLORS.length
                            ];
                          const textColor = theme === 'dark' ? '#fafafa' : '#18181b';
                          const mutedColor = theme === 'dark' ? '#a1a1aa' : '#71717a';
                          return (
                            <div
                              className="rounded-xl px-3.5 py-2.5 shadow-lg"
                              style={{
                                backgroundColor: theme === 'dark' ? '#18181b' : '#fff',
                                border: theme === 'dark' ? '1px solid #27272a' : '1px solid #e4e4e7',
                              }}
                            >
                              <p
                                className="text-sm font-bold mb-1"
                                style={{ color: textColor }}
                              >
                                {name}
                              </p>
                              <p className="text-sm">
                                <span style={{ color: mutedColor }}>Spent: </span>
                                <span
                                  className="font-mono font-bold"
                                  style={{ color: barColor }}
                                >
                                  {formatCurrency(value)}
                                </span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="amount" radius={[0, 6, 6, 0]}>
                        {categorySpending.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {categorySpending.map((cat, i) => {
                    const color = CHART_COLORS[i % CHART_COLORS.length];
                    return (
                      <div
                        key={cat.name}
                        className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="font-bold text-sm text-zinc-900 dark:text-white truncate">
                            {cat.name}
                          </span>
                        </div>
                        <span
                          className="font-mono text-sm font-bold shrink-0 ml-2"
                          style={{ color }}
                        >
                          {formatCurrency(cat.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="bg-white dark:bg-zinc-900 p-6 sm:p-8 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2 font-display flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-600" />
              Spending by month
            </h2>
            <p className="text-sm text-zinc-500 mb-6">Total expenses per month</p>
            {monthSpending.every((m) => m.amount === 0) ? (
              <p className="text-zinc-500 text-sm text-center py-8">No expenses yet</p>
            ) : (
              <>
                <div className="h-[220px] w-full mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthSpending} margin={{ left: -16, right: 8, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" opacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#71717a' }} interval={0} angle={-25} textAnchor="end" height={56} />
                      <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v) => formatCurrency(v)} />
                      <Tooltip
                        formatter={(value: number) => [formatCurrency(value), 'Total']}
                        contentStyle={{ borderRadius: 12, border: 'none', backgroundColor: theme === 'dark' ? '#18181b' : '#fff' }}
                      />
                      <Bar dataKey="amount" fill="#6366f1" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {monthSpendingByYear.map(([year, months]) => {
                    const yearTotal = months.reduce((s, m) => s + m.amount, 0);
                    const expanded = expandedSpendingYears.has(year);
                    return (
                      <div key={year} className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleSpendingYear(year)}
                          className="w-full flex items-center justify-between gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors text-left"
                        >
                          <span className="flex items-center gap-2 font-bold text-sm text-zinc-900 dark:text-white">
                            <ChevronDown
                              className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? '' : '-rotate-90'}`}
                            />
                            {year}
                            <span className="text-zinc-400 font-normal">
                              ({months.length})
                            </span>
                          </span>
                          <span className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                            {formatCurrency(yearTotal)}
                          </span>
                        </button>
                        {expanded && (
                          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {months.map((m) => (
                              <button
                                key={m.groupId}
                                type="button"
                                onClick={() => onSelectGroup(m.groupId)}
                                className="w-full flex items-center justify-between p-3 pl-9 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                              >
                                <span className="font-medium text-sm text-zinc-700 dark:text-zinc-300">
                                  {m.name}
                                </span>
                                <span className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                                  {formatCurrency(m.amount)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <AnimatePresence>
        {isGroupsListOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
              onClick={() => setIsGroupsListOpen(false)}
            />
            <motion.div 
              ref={groupsListModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="select-group-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl overflow-hidden outline-none"
            >
              <div className="p-8">
                <h3 id="select-group-title" className="text-xl font-bold text-zinc-900 dark:text-white mb-6 font-display">Select a Month</h3>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {groups.map(group => (
                  <button
                    key={group.id}
                    onClick={() => {
                      onSelectGroup(group.id);
                      setIsGroupsListOpen(false);
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 border border-zinc-100 dark:border-white/5 transition-all text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-indigo-400" />
                      <span className="font-bold text-zinc-900 dark:text-white">{group.name}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-zinc-400 dark:text-zinc-500 group-hover:translate-x-1 transition-transform" />
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}

        {isHouseholdOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
              onClick={() => setIsHouseholdOpen(false)}
            />
            <motion.div
              ref={householdModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="household-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl overflow-hidden outline-none"
            >
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <h3 id="household-title" className="text-xl font-bold text-zinc-900 dark:text-white font-display">
                  Household
                </h3>
                <button
                  type="button"
                  onClick={() => setIsHouseholdOpen(false)}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                  Share full dashboard access with family or roommates.
                </p>
                {isHouseholdAdmin ? (
                  <form onSubmit={handleInviteHouseholdMember} className="space-y-3">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => {
                            setInviteEmail(e.target.value);
                            setInviteError(null);
                          }}
                          placeholder="person@example.com"
                          className="w-full pl-10 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl text-sm font-medium dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                          required
                          disabled={inviteLoading}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={inviteLoading || !inviteEmail.trim()}
                        className="px-4 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
                      >
                        {inviteLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {inviteError && (
                      <p className="text-xs font-bold text-red-600 dark:text-red-400">{inviteError}</p>
                    )}
                    {inviteSuccess && (
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Invited successfully!</p>
                    )}
                    <p className="text-[11px] text-zinc-400">Account must already exist.</p>
                  </form>
                ) : (
                  <p className="text-xs text-zinc-500">Only the admin can invite members.</p>
                )}
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[40vh] overflow-y-auto">
                {householdMembers.length === 0 ? (
                  <p className="p-6 text-sm text-zinc-500 text-center">Loading…</p>
                ) : (
                  householdMembers.map((member) => (
                    <div key={member.userId} className="p-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold shrink-0 text-sm">
                          {(member.displayName ?? member.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                            {member.displayName ?? member.email.split('@')[0]}
                            {member.userId === user.uid && (
                              <span className="text-zinc-400 font-medium"> (you)</span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500 truncate">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          {member.role}
                        </span>
                        {isHouseholdAdmin && member.userId !== user.uid && (
                          <button
                            type="button"
                            onClick={() => handleRemoveHouseholdMember(member.userId)}
                            disabled={removingUserId === member.userId}
                            className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all disabled:opacity-50"
                            title="Remove"
                          >
                            {removingUserId === member.userId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
    </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-12">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Recent Activity</h2>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
              {recentExpenses.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="w-16 h-16 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Receipt className="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400 font-medium">No recent expenses found.</p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {recentExpenses.map(expense => (
                    <div key={expense.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between transition-all group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400 dark:text-zinc-500 transition-all border border-zinc-100 dark:border-transparent shrink-0">
                          <Receipt className="w-6 h-6 sm:w-7 sm:h-7" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-900 dark:text-white text-base sm:text-lg truncate">{expense.description}</p>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
                            <span className="text-[9px] sm:text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider px-2 py-0.5 sm:px-2.5 sm:py-1 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg border border-indigo-100 dark:border-indigo-500/20">{expense.category}</span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono font-bold">
                              {formatDateShort(toDate(expense.date))}
                            </span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 font-medium italic truncate max-w-[100px] sm:max-w-none">
                              in {groups.find(g => g.id === expense.groupId)?.name}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 border-t border-zinc-100 dark:border-zinc-800 sm:border-0 pt-3 sm:pt-0 shrink-0">
                        <div className="text-left sm:text-right min-w-0">
                          <p 
                            className={`text-lg sm:text-xl font-bold font-mono truncate ${expense.paidBy === user.uid ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-white'}`}
                            title={formatCurrency(expense.amount)}
                          >
                            {formatCurrency(expense.amount)}
                          </p>
                          <p className="text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-widest font-bold mt-0.5">
                            {expense.paidBy === user.uid ? 'You paid' : 'Someone paid'}
                          </p>
                        </div>
                        {expense.paidBy === user.uid && (
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => setEditingExpense(expense)}
                              className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl lg:opacity-0 group-hover:opacity-100 focus:opacity-100 focus:bg-indigo-50 dark:focus:bg-indigo-500/10 transition-all active:scale-90 outline-none focus:ring-2 focus:ring-indigo-500"
                              title="Edit Expense"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => setExpenseToDelete(expense)}
                              className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl lg:opacity-0 group-hover:opacity-100 focus:opacity-100 focus:bg-red-50 dark:focus:bg-red-500/10 transition-all active:scale-90 outline-none focus:ring-2 focus:ring-red-500"
                              title="Delete Expense"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-12">
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Budget Alerts</h2>
            </div>
            <div className="space-y-4">
              {alerts.length === 0 ? (
                <div className="p-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] text-center shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <TrendingDown className="w-6 h-6 text-emerald-500" />
                  </div>
                  {monthsWithBudget.length === 0 ? (
                    <>
                      <p className="text-zinc-900 dark:text-white text-sm font-bold mb-2">
                        No budget limits set
                      </p>
                      <p className="text-zinc-500 text-sm font-medium leading-relaxed max-w-xs mx-auto">
                        Set <strong>Max Budget</strong> when creating a month or in month settings to get overspend and near-limit alerts here.
                      </p>
                    </>
                  ) : (
                    <p className="text-zinc-500 text-sm font-medium">
                      All {monthsWithBudget.length} budget{monthsWithBudget.length !== 1 ? 's' : ''} on track
                    </p>
                  )}
                </div>
              ) : (
                alerts.map((alert) => (
                  <motion.button
                    key={alert.id}
                    type="button"
                    onClick={() => onSelectGroup(alert.groupId)}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`w-full text-left p-6 rounded-[32px] border shadow-md transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] ${
                      alert.type === 'warning'
                        ? 'bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-900/50 text-red-900 dark:text-red-100 backdrop-blur-sm'
                        : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-100'
                    }`}
                  >
                    <div className="flex gap-4">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          alert.type === 'warning'
                            ? 'bg-red-500/10 dark:bg-red-500/20'
                            : 'bg-amber-500/10 dark:bg-amber-500/20'
                        }`}
                      >
                        <TrendingUp
                          className={`w-5 h-5 ${
                            alert.type === 'warning'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        />
                      </div>
                      <p className="text-sm font-bold leading-relaxed">{alert.message}</p>
                    </div>
                  </motion.button>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {editingExpense && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setEditingExpense(null)}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-expense-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 outline-none"
              tabIndex={-1}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="edit-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Edit Expense</h3>
                <button 
                  onClick={() => setEditingExpense(null)} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              
              <form onSubmit={handleUpdateExpense} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Amount</label>
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">{CURRENCY_SYMBOL}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold dark:text-white"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Description</label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    placeholder="What was this for?"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white"
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.name}>
                          {cat.name} ({cat.priority})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Date</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all mt-4 flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-500/20 active:scale-95"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {expenseToDelete && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setExpenseToDelete(null)}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
            />
            <motion.div
              ref={deleteExpenseModalRef}
              tabIndex={-1}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-expense-title"
              aria-describedby="delete-expense-desc"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 id="delete-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-display">Delete Expense?</h3>
              <p id="delete-expense-desc" className="text-zinc-500 dark:text-zinc-400 mb-10 leading-relaxed">
                Are you sure you want to delete this expense? This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setExpenseToDelete(null)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteExpense}
                  disabled={isDeleting}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-red-500/20 active:scale-95"
                >
                  {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ExpenseImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        categoryNames={categoryNames}
      />
    </div>
  );
}
