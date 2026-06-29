import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Landmark,
  CreditCard,
  Trash2,
  Loader2,
  X,
  Pencil,
  Calendar,
  FileUp,
  ChevronDown,
} from 'lucide-react';
import type { Credit, InterestRatePeriod } from '../types';
import {
  createCredit,
  deleteCredit,
  interestRateLabel,
  listCredits,
  subscribeToCredits,
  updateCredit,
} from '../lib/credits';
import { formatCurrency, formatDate, formatMonthYearFromParts } from '../utils/format';
import { toDate } from '../lib/dates';
import LoanImportModal from './LoanImportModal';

interface CreditsViewProps {
  onSelectMonth?: (groupId: string) => void;
}

function toDateInput(iso?: string): string {
  if (!iso) return '';
  return toDate(iso).toISOString().split('T')[0];
}

export default function CreditsView({ onSelectMonth }: CreditsViewProps) {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [expandedLoanYears, setExpandedLoanYears] = useState<
    Record<string, Set<number>>
  >({});

  const currentYear = new Date().getFullYear();

  const toggleLoanYear = (creditId: string, year: number) => {
    setExpandedLoanYears((prev) => {
      const set = new Set(prev[creditId] ?? [currentYear]);
      if (set.has(year)) set.delete(year);
      else set.add(year);
      return { ...prev, [creditId]: set };
    });
  };

  const isLoanYearExpanded = (creditId: string, year: number) => {
    const set = expandedLoanYears[creditId];
    if (set) return set.has(year);
    return year === currentYear;
  };

  const paymentsByYear = (credit: Credit) => {
    const map = new Map<number, Credit['payments']>();
    for (const p of credit.payments) {
      if (!map.has(p.year)) map.set(p.year, []);
      map.get(p.year)!.push(p);
    }
    return [...map.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, payments]) => ({
        year,
        payments: payments.sort((a, b) => a.paymentNumber - b.paymentNumber),
        total: payments.reduce((s, p) => s + p.amount, 0),
      }));
  };
  const [editingCredit, setEditingCredit] = useState<Credit | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [interestRatePeriod, setInterestRatePeriod] =
    useState<InterestRatePeriod>('annual');
  const [termMonths, setTermMonths] = useState('12');
  const [paymentDay, setPaymentDay] = useState('10');
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split('T')[0],
  );

  useEffect(() => subscribeToCredits(setCredits, console.error), []);

  useEffect(() => {
    if (!editingCredit) return;
    const updated = credits.find((c) => c.id === editingCredit.id);
    if (updated) setEditingCredit(updated);
  }, [credits, editingCredit?.id]);

  const resetForm = () => {
    setEditingCredit(null);
    setName('');
    setLender('');
    setPrincipal('');
    setInterestRate('0');
    setInterestRatePeriod('annual');
    setTermMonths('12');
    setPaymentDay('10');
    setStartDate(new Date().toISOString().split('T')[0]);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (credit: Credit) => {
    setEditingCredit(credit);
    setName(credit.name);
    setLender(credit.lender ?? '');
    setPrincipal(String(credit.principal));
    setInterestRate(String(credit.interestRate));
    setInterestRatePeriod(credit.interestRatePeriod ?? 'annual');
    setTermMonths(String(credit.termMonths));
    setPaymentDay(String(credit.paymentDay));
    setStartDate(toDateInput(credit.startDate));
    setError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrincipal = Number(principal);
    const parsedTerm = Math.max(1, parseInt(termMonths, 10) || 1);
    const parsedRate = Math.max(0, Number(interestRate) || 0);
    const parsedDay = Math.min(
      28,
      Math.max(1, parseInt(paymentDay, 10) || 10),
    );

    if (!name.trim() || !Number.isFinite(parsedPrincipal) || parsedPrincipal <= 0) {
      setError('Enter loan name and a valid principal amount');
      return;
    }
    if (parsedRate > 100) {
      setError('Interest rate must be between 0 and 100');
      return;
    }

    const payload = {
      name: name.trim(),
      lender: lender.trim() || undefined,
      principal: parsedPrincipal,
      interestRate: parsedRate,
      interestRatePeriod,
      termMonths: parsedTerm,
      paymentDay: parsedDay,
      startDate: new Date(startDate).toISOString(),
    };

    setSubmitting(true);
    setError('');
    try {
      if (editingCredit) {
        await updateCredit(editingCredit.id, payload);
      } else {
        await createCredit(payload);
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save loan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        'Delete this loan? All scheduled payments will be removed from months.',
      )
    ) {
      return;
    }
    try {
      await deleteCredit(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const paymentBlock = (credit: Credit) => (
    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
        <CreditCard className="w-4 h-4" />
        Loan payment plan
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Principal
          </p>
          <p className="font-bold text-zinc-900 dark:text-white">
            {formatCurrency(credit.principal)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            {interestRateLabel(credit.interestRatePeriod)}
          </p>
          <p className="font-bold text-zinc-900 dark:text-white">
            {credit.interestRate.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Term
          </p>
          <p className="font-bold text-zinc-900 dark:text-white">
            {credit.termMonths} mo
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Debit day
          </p>
          <p className="font-bold text-zinc-900 dark:text-white">
            {credit.paymentDay}th
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Est. monthly payment
          </p>
          <p className="font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(
              credit.payments[0]?.amount ??
                credit.monthlyPayment ??
                credit.principal / credit.termMonths,
            )}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Total with interest
          </p>
          <p className="font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(credit.totalScheduled ?? credit.principal)}
          </p>
        </div>
      </div>
      {(credit.totalInterest ?? 0) > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Total interest: {formatCurrency(credit.totalInterest ?? 0)}
        </p>
      )}
      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
        Schedule · debited on the {credit.paymentDay}th (from next month)
      </p>
      <div className="space-y-2">
        {paymentsByYear(credit).map(({ year, payments, total }) => {
          const expanded = isLoanYearExpanded(credit.id, year);
          return (
            <div
              key={year}
              className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleLoanYear(credit.id, year)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 transition-colors text-left"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-zinc-700 dark:text-zinc-200">
                  <ChevronDown
                    className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? '' : '-rotate-90'}`}
                  />
                  {year}
                  <span className="text-zinc-400 font-normal">
                    ({payments.length})
                  </span>
                </span>
                <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                  {formatCurrency(total)}
                </span>
              </button>
              {expanded && (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800">
                  {payments.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectMonth?.(p.groupId)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 pl-9 bg-zinc-50/50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left text-sm"
                    >
                      <span className="text-zinc-600 dark:text-zinc-300">
                        #{p.paymentNumber} ·{' '}
                        {formatMonthYearFromParts(p.month, p.year)} · day{' '}
                        {credit.paymentDay}
                      </span>
                      <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400 shrink-0">
                        {formatCurrency(p.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white font-display flex items-center gap-3">
            <Landmark className="w-8 h-8 text-emerald-500" />
            Loans (Halva&apos;a)
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2 text-sm">
            Track loans with interest, term, and automatic monthly payment schedule
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-2xl text-sm font-bold hover:opacity-90 transition-all active:scale-95"
          >
            <FileUp className="w-4 h-4" />
            Import schedule
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Add Loan
          </button>
        </div>
      </div>

      {credits.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 p-16 text-center">
          <Landmark className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-500 font-medium">
            No loans yet — add your first credit
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {credits.map((credit) => (
            <motion.div
              key={credit.id}
              layout
              className="bg-white dark:bg-zinc-900 rounded-[32px] border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 shadow-xl shadow-zinc-200/50 dark:shadow-black/20"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
                    {credit.name}
                  </h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
                    {credit.lender && (
                      <span className="flex items-center gap-1.5">
                        <Landmark className="w-4 h-4" />
                        {credit.lender}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      Started {formatDate(toDate(credit.startDate))}
                    </span>
                  </div>
                  {paymentBlock(credit)}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(credit)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(credit.id)}
                    className="p-2.5 rounded-xl text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete loan"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white font-display">
                  {editingCredit ? 'Edit Loan' : 'Add Loan'}
                </h2>
                <button
                  type="button"
                  onClick={closeModal}
                  className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-5">
                {error && (
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                    {error}
                  </p>
                )}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Loan name
                  </label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Car loan, Mortgage"
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Lender / Bank
                  </label>
                  <input
                    value={lender}
                    onChange={(e) => setLender(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Principal (₪)
                    </label>
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={principal}
                      onChange={(e) => setPrincipal(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Term (months)
                    </label>
                    <input
                      required
                      type="number"
                      min="1"
                      max="360"
                      value={termMonths}
                      onChange={(e) => setTermMonths(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Rate period
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setInterestRatePeriod('annual')}
                      className={`px-3 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                        interestRatePeriod === 'annual'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      Annual (ribit shnatit)
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterestRatePeriod('monthly')}
                      className={`px-3 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                        interestRatePeriod === 'monthly'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      Monthly
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      {interestRateLabel(interestRatePeriod)} (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={interestRate}
                      onChange={(e) => setInterestRate(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Debit day of month
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="28"
                      value={paymentDay}
                      onChange={(e) => setPaymentDay(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Loan start date
                  </label>
                  <input
                    required
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                  <p className="text-xs text-zinc-500 mt-2">
                    Payments are scheduled from the month after start date. Debit
                    on day {paymentDay || '10'} each month.
                  </p>
                </div>
                {editingCredit && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Changing terms will recalculate all scheduled payments in
                    your months.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : editingCredit ? (
                    <Pencil className="w-5 h-5" />
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                  {editingCredit ? 'Save changes' : 'Create loan'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <LoanImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onComplete={() => {
          void listCredits().then(setCredits).catch(console.error);
        }}
      />
    </div>
  );
}
