import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Plus, 
  Users, 
  Receipt, 
  MoreVertical, 
  Trash2, 
  TrendingUp,
  PieChart as PieChartIcon,
  Calendar,
  Tag,
  CreditCard,
  BarChart3,
  Sparkles,
  Loader2,
  Pencil,
  X,
  Wallet,
  Shield,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { fetchSpendingInsights } from '../lib/ai-insights';
import { ApiError } from '../lib/api';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { AppUser } from '../types';
import { Group, Expense, GroupMember, Income, Participant, BudgetType } from '../types';
import { useCategories } from '../contexts/CategoriesContext';
import { formatCurrency, formatDate, formatMonthYearFromParts, formatMonthShort, CURRENCY_SYMBOL, MONTH_OPTIONS, yearOptions } from '../utils/format';
import { handleDbError, OperationType } from '../utils/errorHandling';
import { useAuth } from '../contexts/AuthContext';
import {
  createExpense,
  createIncome,
  deleteExpense as deleteExpenseDoc,
  deleteGroup,
  deleteIncome,
  listGroupParticipants,
  subscribeToGroup,
  subscribeToGroupExpenses,
  subscribeToGroupIncomes,
  subscribeToGroupMembers,
  subscribeToGroupParticipants,
  updateExpense,
  updateGroup,
} from '../lib/budgetDb';
import { dateToIso, toDate } from '../lib/dates';

interface GroupViewProps {
  groupId: string;
  user: AppUser;
  onBack: () => void;
  theme: 'light' | 'dark';
}

export default function GroupView({ groupId, user, onBack, theme }: GroupViewProps) {
  const { accessToken } = useAuth();
  const { categories, categoryNames } = useCategories();
  const [group, setGroup] = useState<Group | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isAddIncomeOpen, setIsAddIncomeOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Form states
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeSource, setIncomeSource] = useState('');
  const [incomeParticipantId, setIncomeParticipantId] = useState('');
  const [incomeDate, setIncomeDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Settings states
  const [editMonth, setEditMonth] = useState(1);
  const [editYear, setEditYear] = useState(new Date().getFullYear());
  const [editMaxBudget, setEditMaxBudget] = useState('');

  // AI Analysis states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const analysisAbortController = useRef<AbortController | null>(null);

  // Stat details modal state
  const [selectedStatDetails, setSelectedStatDetails] = useState<{ title: string; amount: number; subtitle?: string } | null>(null);

  const statModalRef = useRef<HTMLDivElement>(null);
  const analysisModalRef = useRef<HTMLDivElement>(null);
  const deleteGroupModalRef = useRef<HTMLDivElement>(null);
  const deleteExpenseModalRef = useRef<HTMLDivElement>(null);

  const closeAnalysisModal = () => {
    setIsAnalysisModalOpen(false);
    if (analysisAbortController.current) {
      analysisAbortController.current.abort();
      analysisAbortController.current = null;
    }
    setIsAnalyzing(false);
    setAnalysisResult(null);
  };

  // Delete confirmation state
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);
  const [isDeleteGroupConfirmOpen, setIsDeleteGroupConfirmOpen] = useState(false);

  useEffect(() => {
    if (selectedStatDetails && statModalRef.current) {
      statModalRef.current.focus();
    }
  }, [selectedStatDetails]);

  useEffect(() => {
    if (isAnalysisModalOpen && analysisModalRef.current) {
      analysisModalRef.current.focus();
    }
  }, [isAnalysisModalOpen]);

  useEffect(() => {
    if (isDeleteGroupConfirmOpen && deleteGroupModalRef.current) {
      deleteGroupModalRef.current.focus();
    }
  }, [isDeleteGroupConfirmOpen]);

  useEffect(() => {
    if (expenseToDelete && deleteExpenseModalRef.current) {
      deleteExpenseModalRef.current.focus();
    }
  }, [expenseToDelete]);

  useEffect(() => {
    const unsubscribeGroup = subscribeToGroup(
      groupId,
      (nextGroup) => {
        if (nextGroup) {
          setGroup(nextGroup);
          setEditMonth(nextGroup.month);
          setEditYear(nextGroup.year);
          setEditMaxBudget(nextGroup.maxBudget?.toString() || '');
        } else {
          setGroup(null);
        }
      },
      (error) => console.error('Error fetching group:', error),
    );

    const unsubscribeExpenses = subscribeToGroupExpenses(
      groupId,
      setExpenses,
      (error) => console.error('Error fetching expenses:', error),
    );

    const unsubscribeMembers = subscribeToGroupMembers(
      groupId,
      setMembers,
      (error) => console.error('Error fetching members:', error),
    );

    const unsubscribeParticipants = subscribeToGroupParticipants(
      groupId,
      setParticipants,
      (error) => console.error('Error fetching participants:', error),
    );

    const unsubscribeIncomes = subscribeToGroupIncomes(
      groupId,
      setIncomes,
      (error) => console.error('Error fetching incomes:', error),
    );

    return () => {
      unsubscribeGroup();
      unsubscribeExpenses();
      unsubscribeMembers();
      unsubscribeParticipants();
      unsubscribeIncomes();
    };
  }, [groupId]);

  useEffect(() => {
    if (editingExpense) {
      setAmount(editingExpense.amount.toString());
      setDescription(editingExpense.description);
      setCategory(editingExpense.category);
      setDate(toDate(editingExpense.date).toISOString().split('T')[0]);
      setIsAddExpenseOpen(true);
    } else {
      setAmount('');
      setDescription('');
      setCategory(categoryNames[0] ?? '');
      setDate(new Date().toISOString().split('T')[0]);
    }
  }, [editingExpense, categoryNames]);

  useEffect(() => {
    if (categoryNames.length && !category && !editingExpense) {
      setCategory(categoryNames[0]);
    }
  }, [categoryNames, category, editingExpense]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAddExpenseOpen(false);
        setIsAddIncomeOpen(false);
        setIsSettingsOpen(false);
        closeAnalysisModal();
        setIsDeleteGroupConfirmOpen(false);
        setExpenseToDelete(null);
        setEditingExpense(null);
        setSelectedStatDetails(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description || !accessToken) return;

    try {
      if (editingExpense) {
        await updateExpense(editingExpense.id, {
          amount: parseFloat(amount),
          description: description.trim(),
          category,
          date: dateToIso(new Date(date)),
        });
      } else {
        await createExpense(groupId, user, {
          amount: parseFloat(amount),
          description: description.trim(),
          category,
          date: new Date(date),
        });
      }

      setIsAddExpenseOpen(false);
      setEditingExpense(null);
      setAmount('');
      setDescription('');
    } catch (error) {
      handleDbError(
        error,
        editingExpense ? OperationType.UPDATE : OperationType.CREATE,
        `expenses`,
        user.uid,
      );
    }
  };

  const handleAddIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incomeAmount || !incomeSource.trim() || !incomeParticipantId || !accessToken) return;

    try {
      const income = await createIncome(groupId, {
        participantId: incomeParticipantId,
        amount: parseFloat(incomeAmount),
        source: incomeSource.trim(),
        date: new Date(incomeDate),
      });
      setIncomes((prev) => [income, ...prev]);
      void listGroupParticipants(groupId).then(setParticipants);
      setIsAddIncomeOpen(false);
      setIncomeAmount('');
      setIncomeSource('');
      setIncomeParticipantId('');
      setIncomeDate(new Date().toISOString().split('T')[0]);
    } catch (error) {
      handleDbError(error, OperationType.CREATE, `incomes`, user.uid);
    }
  };

  const handleDeleteIncome = async (id: string) => {
    if (!accessToken) return;
    try {
      await deleteIncome(id);
    } catch (error) {
      handleDbError(error, OperationType.DELETE, `incomes/${id}`, user.uid);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!accessToken) return;
    try {
      await deleteExpenseDoc(id);
      setExpenseToDelete(null);
    } catch (error) {
      handleDbError(error, OperationType.DELETE, `expenses/${id}`, user.uid);
    }
  };

  const handleDeleteGroup = async () => {
    if (!accessToken) return;
    try {
      await deleteGroup(groupId);
      onBack();
    } catch (error) {
      handleDbError(error, OperationType.DELETE, `groups/${groupId}`, user.uid);
    }
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;

    try {
      await updateGroup(groupId, {
        month: editMonth,
        year: editYear,
        maxBudget: editMaxBudget ? parseFloat(editMaxBudget) : undefined,
        budgetType: editMaxBudget ? 'monthly' : 'total',
      });
      setIsSettingsOpen(false);
    } catch (error) {
      handleDbError(error, OperationType.UPDATE, `groups/${groupId}`, user.uid);
    }
  };

  const openAddIncomeModal = () => {
    if (participants.length > 0 && !incomeParticipantId) {
      setIncomeParticipantId(participants[0].id);
    }
    if (group) {
      const now = new Date();
      const inGroupMonth =
        now.getMonth() + 1 === group.month && now.getFullYear() === group.year;
      const day = inGroupMonth ? now.getDate() : 1;
      const month = String(group.month).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      setIncomeDate(`${group.year}-${month}-${dayStr}`);
    }
    setIsAddIncomeOpen(true);
  };

  const incomeDateBounds = group
    ? {
        min: `${group.year}-${String(group.month).padStart(2, '0')}-01`,
        max: `${group.year}-${String(group.month).padStart(2, '0')}-${String(new Date(group.year, group.month, 0).getDate()).padStart(2, '0')}`,
      }
    : null;

  const isInGroupMonth = (d: Date) => {
    if (!group) return true;
    return d.getMonth() + 1 === group.month && d.getFullYear() === group.year;
  };

  const currentPeriodExpenses = expenses.filter((e) =>
    isInGroupMonth(toDate(e.date)),
  );
  const monthIncomes = incomes.filter((i) => isInGroupMonth(toDate(i.date)));
  const totalIncome = monthIncomes.reduce((sum, i) => sum + i.amount, 0);

  const scheduledSpend =
    (group?.installments?.reduce((sum, i) => sum + i.amount, 0) ?? 0) +
    (group?.creditPayments?.reduce((sum, c) => sum + c.amount, 0) ?? 0) +
    (group?.insurancePayments?.reduce((sum, ip) => sum + ip.amount, 0) ?? 0) +
    (group?.shoppingTrips?.reduce((sum, t) => sum + t.totalAmount, 0) ?? 0);

  const expenseSpend = currentPeriodExpenses.reduce(
    (sum, e) => sum + e.amount,
    0,
  );
  const totalSpent = expenseSpend + scheduledSpend;
  const userSpent = currentPeriodExpenses
    .filter((e) => e.paidBy === user.uid)
    .reduce((sum, e) => sum + e.amount, 0);
  const perPerson = participants.length > 0 ? totalSpent / participants.length : 0;
  const balance = userSpent - perPerson;

  // Budget calculation (expenses + scheduled product/loan/insurance payments)
  const currentBudgetSpent = totalSpent;

  // Chart Data Preparation
  const getLineChartData = () => {
    if (!group || group.budgetType === 'total') return [];

    const chartYear = group.year;
    const data = [];

    if (group.budgetType === 'weekly') {
      const firstDayOfYear = new Date(chartYear, 0, 1);
      const startOfFirstWeek = new Date(firstDayOfYear);
      startOfFirstWeek.setDate(firstDayOfYear.getDate() - firstDayOfYear.getDay());
      startOfFirstWeek.setHours(0, 0, 0, 0);

      let scheduledAllocated = false;

      for (let i = 0; i < 52; i++) {
        const weekStart = new Date(startOfFirstWeek);
        weekStart.setDate(startOfFirstWeek.getDate() + i * 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);

        let weekSpent = expenses
          .filter((e) => {
            const ed = toDate(e.date);
            return (
              ed >= weekStart &&
              ed < weekEnd &&
              ed.getFullYear() === chartYear
            );
          })
          .reduce((sum, e) => sum + e.amount, 0);

        if (
          !scheduledAllocated &&
          weekStart.getMonth() + 1 === group.month &&
          weekStart.getFullYear() === chartYear
        ) {
          weekSpent += scheduledSpend;
          scheduledAllocated = true;
        }

        data.push({
          name: `W${i + 1}`,
          amount: Math.round(weekSpent * 100) / 100,
        });
      }
    } else if (group.budgetType === 'monthly') {
      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];
      for (let i = 0; i < 12; i++) {
        let monthSpent = expenses
          .filter((e) => {
            const ed = toDate(e.date);
            return ed.getMonth() === i && ed.getFullYear() === chartYear;
          })
          .reduce((sum, e) => sum + e.amount, 0);
        if (i === group.month - 1) {
          monthSpent += scheduledSpend;
        }
        data.push({ name: monthNames[i], amount: monthSpent });
      }
    }
    return data;
  };

  const getPieChartData = () => {
    const categoryMap = new Map<string, number>();
    currentPeriodExpenses.forEach((e) => {
      categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + e.amount);
    });

    const productsTotal =
      (group?.installments?.reduce((sum, i) => sum + i.amount, 0) ?? 0) +
      (group?.shoppingTrips?.reduce((sum, t) => sum + t.totalAmount, 0) ?? 0);
    const loansTotal =
      group?.creditPayments?.reduce((sum, c) => sum + c.amount, 0) ?? 0;
    const insuranceTotal =
      group?.insurancePayments?.reduce((sum, ip) => sum + ip.amount, 0) ?? 0;

    if (productsTotal > 0) {
      categoryMap.set(
        'Products',
        (categoryMap.get('Products') || 0) + productsTotal,
      );
    }
    if (loansTotal > 0) {
      categoryMap.set('Loans', (categoryMap.get('Loans') || 0) + loansTotal);
    }
    if (insuranceTotal > 0) {
      categoryMap.set(
        'Insurance',
        (categoryMap.get('Insurance') || 0) + insuranceTotal,
      );
    }

    return Array.from(categoryMap.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  };

  const lineData = getLineChartData();
  const pieData = getPieChartData();
  const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#71717a'];

  const getPeriodLabel = () => {
    if (!group) return '';
    return formatMonthYearFromParts(group.month, group.year);
  };

  const handleAnalyzeSpending = async () => {
    setIsAnalyzing(true);
    setIsAnalysisModalOpen(true);
    setAnalysisResult(null);

    if (analysisAbortController.current) {
      analysisAbortController.current.abort();
    }
    const abortController = new AbortController();
    analysisAbortController.current = abortController;

    try {
      const expenseSummary = expenses.map(e => ({
        amount: e.amount,
        description: e.description,
        category: e.category,
        date: formatDate(toDate(e.date))
      }));

      const scheduledSummary = [
        ...(group?.installments?.map((i) => ({
          type: 'Product installment',
          name: i.purchaseName,
          amount: i.amount,
        })) ?? []),
        ...(group?.creditPayments?.map((c) => ({
          type: 'Loan payment',
          name: c.creditName,
          amount: c.amount,
        })) ?? []),
        ...(group?.insurancePayments?.map((ip) => ({
          type: 'Insurance premium',
          name: ip.insuranceName,
          amount: ip.amount,
        })) ?? []),
      ];

      const shoppingTripsSummary =
        group?.shoppingTrips?.map((t) => ({
          storeName: t.storeName,
          tripDate: formatDate(toDate(t.tripDate)),
          totalAmount: t.totalAmount,
          itemCount: t.itemCount,
        })) ?? [];

      const userSharePct =
        expenseSpend > 0 ? Math.round((userSpent / expenseSpend) * 1000) / 10 : 0;

      const { text } = await fetchSpendingInsights({
        groupName: group?.name ?? '',
        groupType: group?.type ?? '',
        budgetType: group?.budgetType ?? 'monthly',
        month: group?.month,
        year: group?.year,
        periodLabel: getPeriodLabel(),
        maxBudget: group?.maxBudget ?? null,
        totalSpent,
        scheduledSpend,
        totalIncome,
        userSpendSharePct: userSharePct,
        memberCount: participants.length,
        expenses: expenseSummary,
        scheduled: scheduledSummary,
        shoppingTrips: shoppingTripsSummary,
      });

      if (abortController.signal.aborted) return;

      setAnalysisResult(text || "Could not generate analysis.");
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || abortController.signal.aborted)
      ) {
        return;
      }
      console.error("AI Analysis Error:", error);
      const msg =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Analysis failed';
      setAnalysisResult(
        `Sorry, analysis failed: ${msg}. Check Ollama is running (ollama serve) and the model is pulled.`,
      );
    } finally {
      if (!abortController.signal.aborted) {
        setIsAnalyzing(false);
      }
    }
  };

  if (!group) return null;

  return (
    <div className="max-w-6xl mx-auto">
      <button 
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-zinc-700 rounded-xl transition-all duration-200 mb-10 group shadow-sm"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        <span className="text-sm font-bold">Back to Dashboard</span>
      </button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-8 mb-12">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
              <Calendar className="w-4 h-4" />
              <span className="text-[10px] font-bold uppercase tracking-widest">{getPeriodLabel()}</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">{group.name}</h1>
        </div>

        <div className="flex flex-wrap items-stretch gap-2 sm:gap-3 w-full md:w-auto">
          {user.uid === group.createdBy && (
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="w-12 sm:w-auto p-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all shadow-sm flex items-center justify-center shrink-0"
              title="Month Settings"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          )}
          <button 
            onClick={openAddIncomeModal}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-3 border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl text-sm font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all active:scale-95"
          >
            <Wallet className="w-4 h-4" />
            Add Income
          </button>
          <button 
            onClick={handleAnalyzeSpending}
            disabled={isAnalyzing}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 sm:px-5 py-3 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl text-sm font-bold hover:from-indigo-700 hover:to-violet-700 hover:shadow-xl hover:shadow-indigo-500/40 transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            AI Insights
          </button>
          <button 
            onClick={() => {
              setEditingExpense(null);
              setIsAddExpenseOpen(true);
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl text-sm font-bold text-zinc-900 dark:text-white hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-lg hover:shadow-indigo-500/10 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Add Expense
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-4 lg:gap-6 mb-12">
        <button 
          onClick={() => setSelectedStatDetails({ title: 'Total Income', amount: totalIncome })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-6 md:p-5 lg:p-8 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-zinc-950/20 relative overflow-hidden group hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 font-display">Total Income</p>
            <p className="text-4xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-emerald-600 dark:text-emerald-400 font-display tracking-tight truncate" title={formatCurrency(totalIncome)}>
              {formatCurrency(totalIncome)}
            </p>
            <p className="text-xs font-medium text-zinc-500 mt-4">
              Balance: {formatCurrency(totalIncome - totalSpent)}
            </p>
          </div>
        </button>
        <button 
          onClick={() => setSelectedStatDetails({ title: 'Total Group Spend', amount: totalSpent })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-6 md:p-5 lg:p-8 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-zinc-950/20 relative overflow-hidden group hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-100 dark:bg-white/5 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 font-display">Total Group Spend</p>
            <p 
              className="text-4xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-zinc-900 dark:text-white font-display tracking-tight truncate"
              title={formatCurrency(totalSpent)}
            >
              {formatCurrency(totalSpent)}
            </p>
            {group.maxBudget && (
              <div className="mt-6">
                <div className="flex justify-between text-[10px] font-bold uppercase mb-2 font-display">
                  <span className="text-zinc-500">Budget ({group.budgetType})</span>
                  <span className={currentBudgetSpent > group.maxBudget ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}>
                    {((currentBudgetSpent / group.maxBudget) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-zinc-100 dark:bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-700 ease-out ${currentBudgetSpent > group.maxBudget ? 'bg-red-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.min(100, (currentBudgetSpent / group.maxBudget) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-zinc-500 mt-2 font-medium">
                  {formatCurrency(currentBudgetSpent)} of {formatCurrency(group.maxBudget)}
                </p>
              </div>
            )}
          </div>
        </button>
        <button 
          onClick={() => setSelectedStatDetails({ title: 'Your Share', amount: perPerson, subtitle: `${totalSpent > 0 ? ((userSpent / totalSpent) * 100).toFixed(0) : 0}% of total paid by you` })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-6 md:p-5 lg:p-8 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 relative overflow-hidden group hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-100 dark:bg-white/5 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
          <div className="relative">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 font-display">Your Share</p>
            <p 
              className="text-4xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-zinc-900 dark:text-white font-display tracking-tight truncate"
              title={formatCurrency(perPerson)}
            >
              {formatCurrency(perPerson)}
            </p>
            <p className="text-xs font-medium text-zinc-500 mt-4">
              {totalSpent > 0 ? ((userSpent / totalSpent) * 100).toFixed(0) : 0}% of total paid by you
            </p>
          </div>
        </button>
        <button 
          onClick={() => setSelectedStatDetails({ title: balance >= 0 ? 'You are owed' : 'You owe', amount: Math.abs(balance) })}
          className="text-left w-full bg-white dark:bg-zinc-900 p-6 md:p-5 lg:p-8 rounded-[32px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 relative overflow-hidden group hover:scale-[1.02] active:scale-95 transition-all duration-300 cursor-pointer"
        >
          <div className={`absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110 ${balance >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`} />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-zinc-500 font-display">
              {balance >= 0 ? 'You are owed' : 'You owe'}
            </p>
            <p 
              className={`text-4xl md:text-2xl lg:text-3xl xl:text-4xl font-bold font-display tracking-tight truncate ${balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
              title={formatCurrency(Math.abs(balance))}
            >
              {formatCurrency(Math.abs(balance))}
            </p>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {group.budgetType !== 'total' && (
          <div className="bg-white dark:bg-zinc-900 p-4 sm:p-8 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-8 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Spending Trend ({group.budgetType})
            </h3>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={lineData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" opacity={0.1} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#a1a1aa', fontWeight: 500 }}
                    interval="preserveStart"
                    minTickGap={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#a1a1aa', fontWeight: 500 }}
                    tickFormatter={(value) => formatCurrency(value)}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none', 
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', 
                      padding: '12px', 
                      backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff', 
                      color: theme === 'dark' ? '#ffffff' : '#18181b' 
                    }}
                    itemStyle={{ fontSize: '12px', fontWeight: 600, color: theme === 'dark' ? '#ffffff' : '#18181b' }}
                    labelStyle={{ fontSize: '10px', color: '#71717a', marginBottom: '4px', textTransform: 'uppercase', fontWeight: 700 }}
                    formatter={(value: number) => [formatCurrency(value), 'Spent']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="amount" 
                    stroke="#4f46e5" 
                    strokeWidth={4} 
                    dot={{ r: 0 }}
                    activeDot={{ r: 6, fill: '#4f46e5', strokeWidth: 3, stroke: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <div className={`bg-white dark:bg-zinc-900 p-4 sm:p-8 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 ${group.budgetType === 'total' ? 'lg:col-span-2' : ''}`}>
          <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-8 flex items-center gap-2">
            <PieChartIcon className="w-4 h-4" />
            Category Distribution
          </h3>
          <div className="h-[280px] w-full">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [formatCurrency(value), 'Total']}
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none', 
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', 
                      padding: '12px', 
                      backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff', 
                      color: theme === 'dark' ? '#ffffff' : '#18181b' 
                    }}
                    itemStyle={{ color: theme === 'dark' ? '#ffffff' : '#18181b' }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 500, paddingTop: '20px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 text-sm">
                <PieChartIcon className="w-10 h-10 mb-2 opacity-20" />
                <p className="font-medium italic">No expenses in this period</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white flex items-center gap-3 font-display">
              <Receipt className="w-6 h-6 text-zinc-400 dark:text-zinc-500" />
              Transaction History
            </h2>
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{expenses.length} Total</div>
          </div>
          
          <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xl shadow-zinc-200/50 dark:shadow-black/20">
            {expenses.length === 0 ? (
              <div className="p-10 sm:p-20 text-center">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Receipt className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-300 dark:text-zinc-600" />
                </div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">No transactions yet</h3>
                <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto text-sm">Start tracking your shared expenses by adding your first transaction.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {expenses.map(expense => (
                  <div key={expense.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between group transition-all duration-200 gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                      <div className="w-12 h-12 sm:w-14 sm:h-14 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 border border-zinc-100 dark:border-zinc-700 group-hover:bg-white dark:group-hover:bg-zinc-800 transition-colors shrink-0">
                        <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-tighter text-zinc-500">{formatMonthShort(toDate(expense.date))}</span>
                        <span className="text-lg sm:text-xl font-bold leading-none text-zinc-900 dark:text-white">{toDate(expense.date).getDate()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-zinc-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">{expense.description}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-[9px] sm:text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider border border-zinc-200 dark:border-zinc-700 shrink-0">{expense.category}</span>
                          <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline shrink-0">•</span>
                          <span className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 font-medium truncate">Paid by {members.find(m => m.uid === expense.paidBy)?.displayName || 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 w-full sm:w-auto shrink-0 mt-4 sm:mt-0">
                      <div className="text-left sm:text-right min-w-0">
                        <p 
                          className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-white font-mono tracking-tight truncate"
                          title={formatCurrency(expense.amount)}
                        >
                          {formatCurrency(expense.amount)}
                        </p>
                        <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Amount</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => setEditingExpense(expense)}
                          className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl sm:opacity-0 group-hover:opacity-100 focus:opacity-100 focus:bg-indigo-50 dark:focus:bg-indigo-500/10 transition-all active:scale-90 outline-none focus:ring-2 focus:ring-indigo-500"
                          title="Edit Expense"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setExpenseToDelete(expense.id)}
                          className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl sm:opacity-0 group-hover:opacity-100 focus:opacity-100 focus:bg-red-50 dark:focus:bg-red-500/10 transition-all active:scale-90 outline-none focus:ring-2 focus:ring-red-500"
                          title="Delete Expense"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6 flex items-center gap-3 font-display">
            <Users className="w-6 h-6 text-zinc-400 dark:text-zinc-500" />
            People
          </h2>
          <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
            {participants.length === 0 ? (
              <div className="p-10 sm:p-20 text-center">
                <Users className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
                <p className="text-zinc-500 font-medium text-sm">
                  Invite people from Dashboard → Household
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {participants.map(participant => (
                  <div key={participant.id} className="p-4 sm:p-6 flex items-center justify-between group">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400 dark:text-zinc-500 font-bold border border-zinc-100 dark:border-zinc-700 group-hover:border-indigo-500 transition-colors">
                          {participant.name?.charAt(0)}
                        </div>
                        {participant.userId === group.createdBy && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-600 rounded-full border-2 border-white dark:border-zinc-900 flex items-center justify-center">
                            <Sparkles className="w-2 h-2 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{participant.name}</p>
                        <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest truncate">
                          Income: {formatCurrency(participant.totalIncome)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {group.installments && group.installments.length > 0 && (
        <section>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6 flex items-center gap-3 font-display">
            <CreditCard className="w-6 h-6 text-indigo-500" />
            Scheduled Product Payments
          </h2>
          <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {group.installments.map((inst) => (
                <div
                  key={inst.id}
                  className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 dark:text-white">
                      {inst.purchaseName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {inst.store && (
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">
                          {inst.store}
                        </span>
                      )}
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase">
                        Payment {inst.installmentNumber}
                      </span>
                    </div>
                  </div>
                  <p className="text-lg font-bold font-mono text-indigo-600 dark:text-indigo-400">
                    {formatCurrency(inst.amount)}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 bg-indigo-50 dark:bg-indigo-900/20 border-t border-indigo-100 dark:border-indigo-800/50 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                Total scheduled
              </span>
              <span className="font-bold text-indigo-700 dark:text-indigo-300">
                {formatCurrency(
                  group.installments.reduce((sum, i) => sum + i.amount, 0),
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      {group.shoppingTrips && group.shoppingTrips.length > 0 && (
        <section>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6 flex items-center gap-3 font-display">
            <Receipt className="w-6 h-6 text-emerald-500" />
            Store purchases
          </h2>
          <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {group.shoppingTrips.map((trip) => (
                <div
                  key={trip.id}
                  className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 dark:text-white">
                      {trip.storeName ?? 'Supermarket'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">
                        {formatDate(toDate(trip.tripDate))}
                      </span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase">
                        {trip.itemCount} items
                      </span>
                    </div>
                  </div>
                  <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(trip.totalAmount)}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-100 dark:border-emerald-800/50 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                Total groceries
              </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300">
                {formatCurrency(
                  group.shoppingTrips.reduce((sum, t) => sum + t.totalAmount, 0),
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      {group.creditPayments && group.creditPayments.length > 0 && (
        <section>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6 flex items-center gap-3 font-display">
            <CreditCard className="w-6 h-6 text-emerald-500" />
            Scheduled Loan Payments
          </h2>
          <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {group.creditPayments.map((cp) => (
                <div
                  key={cp.id}
                  className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 dark:text-white">
                      {cp.creditName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {cp.lender && (
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">
                          {cp.lender}
                        </span>
                      )}
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase">
                        Payment {cp.paymentNumber} · day {cp.paymentDay}
                      </span>
                    </div>
                  </div>
                  <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(cp.amount)}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-100 dark:border-emerald-800/50 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                Total scheduled
              </span>
              <span className="font-bold text-emerald-700 dark:text-emerald-300">
                {formatCurrency(
                  group.creditPayments.reduce((sum, i) => sum + i.amount, 0),
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      {group.insurancePayments && group.insurancePayments.length > 0 && (
        <section>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6 flex items-center gap-3 font-display">
            <Shield className="w-6 h-6 text-sky-500" />
            Scheduled Insurance Premiums
          </h2>
          <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {group.insurancePayments.map((ip) => (
                <div
                  key={ip.id}
                  className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 dark:text-white">
                      {ip.insuranceName}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">
                        {ip.company}
                      </span>
                      {ip.subjectLabel && (
                        <span className="text-[10px] text-sky-600 dark:text-sky-400 font-bold uppercase">
                          {ip.subjectLabel}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-400 font-bold uppercase">
                        Payment {ip.paymentNumber} · day {ip.paymentDay}
                      </span>
                    </div>
                  </div>
                  <p className="text-lg font-bold font-mono text-sky-600 dark:text-sky-400">
                    {formatCurrency(ip.amount)}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 bg-sky-50 dark:bg-sky-900/20 border-t border-sky-100 dark:border-sky-800/50 flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">
                Total scheduled
              </span>
              <span className="font-bold text-sky-700 dark:text-sky-300">
                {formatCurrency(
                  group.insurancePayments.reduce((sum, i) => sum + i.amount, 0),
                )}
              </span>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white mb-6 flex items-center gap-3 font-display">
          <Wallet className="w-6 h-6 text-emerald-500" />
          Income
        </h2>
        <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-zinc-200/50 dark:shadow-black/20 overflow-hidden">
          {monthIncomes.length === 0 ? (
            <div className="p-10 sm:p-20 text-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-6">
                <Wallet className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-300 dark:text-zinc-600" />
              </div>
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-2">No income recorded</h3>
              <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto text-sm">Add income using the button above.</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {monthIncomes.map(income => (
                <div key={income.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 group">
                  <div className="min-w-0">
                    <p className="font-bold text-zinc-900 dark:text-white">{income.source}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">{income.participantName}</span>
                      <span className="text-[10px] text-zinc-500">{formatDate(toDate(income.date))}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">{formatCurrency(income.amount)}</p>
                    <button
                      type="button"
                      onClick={() => handleDeleteIncome(income.id)}
                      className="p-2 text-zinc-400 hover:text-red-600 rounded-xl sm:opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete income"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      </div>

      {/* Add Expense Modal */}
      <AnimatePresence>
        {isAddExpenseOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsAddExpenseOpen(false);
                setEditingExpense(null);
              }}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-expense-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-6 sm:p-10 outline-none"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="add-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">
                  {editingExpense ? 'Edit Expense' : 'Add Expense'}
                </h3>
                <button 
                  type="button"
                  onClick={() => {
                    setIsAddExpenseOpen(false);
                    setEditingExpense(null);
                  }} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={handleAddExpense} className="space-y-6">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Amount</label>
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">{CURRENCY_SYMBOL}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold text-lg dark:text-white"
                      placeholder="0.00"
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    placeholder="What was it for?"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium appearance-none dark:text-white"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.name}>{c.name} ({c.priority})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Date</label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium dark:text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-4 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
                >
                  {editingExpense ? 'Update Transaction' : 'Save Transaction'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Income Modal */}
      <AnimatePresence>
        {isAddIncomeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddIncomeOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-income-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-6 sm:p-10 outline-none"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="add-income-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Add Income</h3>
                <button type="button" onClick={() => setIsAddIncomeOpen(false)} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              {participants.length === 0 ? (
                <p className="text-zinc-500 text-sm mb-6">
                  No people in this month yet. Invite someone from the Dashboard → Household.
                </p>
              ) : (
                <form onSubmit={handleAddIncome} className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Person</label>
                    <select
                      value={incomeParticipantId}
                      onChange={(e) => setIncomeParticipantId(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl font-medium dark:text-white"
                      required
                    >
                      <option value="">Select person</option>
                      {participants.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Source</label>
                    <input
                      type="text"
                      value={incomeSource}
                      onChange={(e) => setIncomeSource(e.target.value)}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl font-medium dark:text-white"
                      placeholder="Salary, gift, refund..."
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Amount</label>
                    <div className="relative">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">{CURRENCY_SYMBOL}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={incomeAmount}
                        onChange={(e) => setIncomeAmount(e.target.value)}
                        className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl font-mono font-bold dark:text-white"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Date</label>
                    <input
                      type="date"
                      value={incomeDate}
                      onChange={(e) => setIncomeDate(e.target.value)}
                      min={incomeDateBounds?.min}
                      max={incomeDateBounds?.max}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl font-medium dark:text-white"
                      required
                    />
                  </div>
                  <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all">
                    Add Income
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 max-h-[90vh] overflow-y-auto outline-none"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 id="settings-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Month Settings</h3>
                <button 
                  type="button"
                  onClick={() => setIsSettingsOpen(false)} 
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <form onSubmit={handleUpdateSettings} className="space-y-8">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-6">Month</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Month</label>
                      <select
                        value={editMonth}
                        onChange={(e) => setEditMonth(Number(e.target.value))}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl font-medium dark:text-white"
                      >
                        {MONTH_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Year</label>
                      <select
                        value={editYear}
                        onChange={(e) => setEditYear(Number(e.target.value))}
                        className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl font-medium dark:text-white"
                      >
                        {yearOptions().map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 mb-6">Budget Limits</h4>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2">Max Budget</label>
                      <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-mono font-bold">{CURRENCY_SYMBOL}</span>
                        <input
                          type="number"
                          step="0.01"
                          value={editMaxBudget}
                          onChange={(e) => setEditMaxBudget(e.target.value)}
                          placeholder="No limit"
                          className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono font-bold dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
                >
                  Save Settings
                </button>

                {(members.find(m => m.uid === user.uid)?.role === 'admin' || group?.createdBy === user.uid) && (
                  <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSettingsOpen(false);
                        setIsDeleteGroupConfirmOpen(true);
                      }}
                      className="w-full py-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
                    >
                      <Trash2 className="w-5 h-5" />
                      Delete Group
                    </button>
                  </div>
                )}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* AI Analysis Modal */}
      <AnimatePresence>
        {isAnalysisModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={closeAnalysisModal}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={analysisModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="analysis-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 max-h-[85vh] overflow-y-auto outline-none"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-500/10 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 id="analysis-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">Spending Analysis</h3>
                  <p className="text-zinc-500 dark:text-zinc-400 text-sm">AI-powered insights for {group.name}</p>
                </div>
              </div>

              {isAnalyzing ? (
                <div className="py-16 flex flex-col items-center justify-center gap-6 text-zinc-400">
                  <div className="relative">
                    <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                    <div className="absolute inset-0 blur-lg bg-indigo-400/20 animate-pulse" />
                  </div>
                  <p className="font-bold text-sm uppercase tracking-widest animate-pulse">Analyzing your spending habits...</p>
                </div>
              ) : (
                <div className="max-w-none">
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-[32px] p-8 border border-zinc-200 dark:border-zinc-700 analysis-content dark:text-zinc-300">
                    <Markdown>{analysisResult || ""}</Markdown>
                  </div>
                  <button
                    onClick={closeAnalysisModal}
                    className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-8 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
                  >
                    Close Analysis
                  </button>
                </div>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Group Confirmation Modal */}
      <AnimatePresence>
        {isDeleteGroupConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsDeleteGroupConfirmOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={deleteGroupModalRef}
              tabIndex={-1}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-group-title"
              aria-describedby="delete-group-desc"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 id="delete-group-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">Delete Group?</h3>
              <p id="delete-group-desc" className="text-zinc-500 dark:text-zinc-400 text-sm mb-10 leading-relaxed">This will permanently delete the group <strong>{group?.name}</strong> and all its expenses. This action cannot be undone.</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setIsDeleteGroupConfirmOpen(false)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteGroup}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 dark:shadow-red-500/20 active:scale-95"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stat Details Modal */}
      <AnimatePresence>
        {selectedStatDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStatDetails(null)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={statModalRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="stat-title"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <p id="stat-title" className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4 font-display">{selectedStatDetails.title}</p>
              <p className="text-5xl sm:text-6xl font-bold text-zinc-900 dark:text-white font-display tracking-tight mb-2 break-all">
                {formatCurrency(selectedStatDetails.amount)}
              </p>
              {selectedStatDetails.subtitle && (
                <p className="text-sm font-medium text-zinc-500 mt-4">
                  {selectedStatDetails.subtitle}
                </p>
              )}
              <button
                onClick={() => setSelectedStatDetails(null)}
                className="w-full py-4 bg-zinc-900 dark:bg-indigo-600 text-white rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-indigo-700 transition-all mt-8 shadow-lg shadow-zinc-200 dark:shadow-indigo-500/20 active:scale-95"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {expenseToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setExpenseToDelete(null)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
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
              className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3 id="delete-expense-title" className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display">Delete Expense?</h3>
              <p id="delete-expense-desc" className="text-zinc-500 dark:text-zinc-400 text-sm mb-10 leading-relaxed">This action cannot be undone. Are you sure you want to remove this expense?</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setExpenseToDelete(null)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteExpense(expenseToDelete)}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 dark:shadow-red-500/20 active:scale-95"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
