import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileUp,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  Landmark,
} from 'lucide-react';
import {
  commitLoanImport,
  parseLoanScheduleFiles,
  type LoanImportPayment,
  type LoanImportSchedule,
} from '../lib/loan-import';
import { formatCurrency, formatMonthYearFromParts } from '../utils/format';

interface LoanImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

function monthKey(p: LoanImportPayment) {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export default function LoanImportModal({
  isOpen,
  onClose,
  onComplete,
}: LoanImportModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [schedule, setSchedule] = useState<LoanImportSchedule | null>(null);
  const [payments, setPayments] = useState<LoanImportPayment[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ name: string; months: string[] } | null>(
    null,
  );

  const grouped = useMemo(() => {
    const map = new Map<string, LoanImportPayment[]>();
    for (const p of payments) {
      const k = monthKey(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [payments]);

  const selected = payments.filter((p) => p.selected);
  const selectedTotal = selected.reduce((s, p) => s + p.amount, 0);

  const reset = () => {
    setFiles([]);
    setSchedule(null);
    setPayments([]);
    setWarnings([]);
    setError('');
    setDone(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleParse = async () => {
    if (!files.length) return;
    setParsing(true);
    setError('');
    setDone(null);
    try {
      const result = await parseLoanScheduleFiles(files);
      setWarnings(result.warnings);
      if (result.schedule) {
        setSchedule(result.schedule);
        setPayments(result.schedule.payments);
      } else {
        setSchedule(null);
        setPayments([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!schedule || !selected.length) return;
    setImporting(true);
    setError('');
    try {
      const result = await commitLoanImport({
        name: schedule.name,
        lender: schedule.lender,
        principal: schedule.principal,
        paymentDay: schedule.paymentDay,
        startDate: schedule.startDate,
        payments: selected,
      });
      setDone({ name: result.credit.name, months: result.months });
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const updatePayment = (id: string, patch: Partial<LoanImportPayment>) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="relative w-full sm:max-w-3xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="p-5 sm:p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-3 shrink-0">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white font-display flex items-center gap-2">
                <Landmark className="w-6 h-6 text-emerald-500" />
                Import loan schedule
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Photo or PDF of amortization table (Cal, bank) — AI reads each
                month. For photos, Gemini OCR works best (
                <code className="text-xs">RECEIPT_OCR_PROVIDER=gemini</code>
                ).
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
            {done ? (
              <div className="text-center py-8 space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
                <p className="text-lg font-bold text-zinc-900 dark:text-white">
                  Loan &quot;{done.name}&quot; created
                </p>
                <p className="text-sm text-zinc-500">
                  Payments in months: {done.months.join(', ') || '—'}
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-4 px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <label className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-emerald-300 dark:border-emerald-800 rounded-2xl cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                  <FileUp className="w-10 h-10 text-emerald-500" />
                  <span className="font-bold text-sm text-zinc-700 dark:text-zinc-300">
                    Photo or PDF of loan schedule
                  </span>
                  <span className="text-xs text-zinc-500 text-center">
                    e.g. Cal לוח סילוקין — table with dates and monthly amounts
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf,image/*"
                    className="hidden"
                    onChange={(e) => {
                      setFiles([...(e.target.files ?? [])]);
                      setSchedule(null);
                      setPayments([]);
                      setWarnings([]);
                    }}
                  />
                </label>

                {files.length > 0 && (
                  <ul className="text-xs text-zinc-500 space-y-1">
                    {files.map((f) => (
                      <li key={f.name + f.size}>• {f.name}</li>
                    ))}
                  </ul>
                )}

                {schedule && (
                  <div className="text-sm bg-emerald-500/10 rounded-xl p-4 space-y-1">
                    <p className="font-bold text-emerald-800 dark:text-emerald-300">
                      {schedule.name}
                      {schedule.lender ? ` · ${schedule.lender}` : ''}
                    </p>
                    <p className="text-zinc-600 dark:text-zinc-400">
                      Principal {formatCurrency(schedule.principal)} ·{' '}
                      {schedule.termMonths} payments · debit day{' '}
                      {schedule.paymentDay}
                    </p>
                  </div>
                )}

                {warnings.length > 0 && (
                  <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-xl p-3 space-y-1">
                    {warnings.map((w) => (
                      <p key={w} className="flex gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                )}

                {grouped.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span className="font-bold text-zinc-700 dark:text-zinc-300">
                        {selected.length} payments ·{' '}
                        {formatCurrency(selectedTotal)}
                      </span>
                      <button
                        type="button"
                        className="text-emerald-600 text-xs font-bold"
                        onClick={() =>
                          setPayments((prev) =>
                            prev.map((p) => ({ ...p, selected: true })),
                          )
                        }
                      >
                        Select all
                      </button>
                    </div>

                    {grouped.map(([key, monthPayments]) => {
                      const [y, m] = key.split('-').map(Number);
                      return (
                        <div key={key} className="space-y-2">
                          <h3 className="text-sm font-black text-emerald-600 dark:text-emerald-400 sticky top-0 bg-white dark:bg-zinc-900 py-1">
                            {formatMonthYearFromParts(m, y)} (
                            {monthPayments.length})
                          </h3>
                          <div className="space-y-1">
                            {monthPayments.map((p) => (
                              <div
                                key={p.id}
                                className={`flex items-center gap-2 p-2 rounded-xl text-sm border ${
                                  p.selected
                                    ? 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5'
                                    : 'border-transparent opacity-50'
                                }`}
                              >
                                <label className="flex items-center gap-2 flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={p.selected}
                                    onChange={(e) =>
                                      updatePayment(p.id, {
                                        selected: e.target.checked,
                                      })
                                    }
                                  />
                                  <span className="font-mono text-xs text-zinc-500 w-8">
                                    #{p.paymentNumber}
                                  </span>
                                  <span className="font-mono text-xs text-zinc-500 w-24">
                                    {p.date}
                                  </span>
                                  <span className="truncate text-zinc-700 dark:text-zinc-300">
                                    Loan payment
                                  </span>
                                </label>
                                <span className="font-bold shrink-0">
                                  {formatCurrency(p.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-500 bg-red-500/10 rounded-xl p-3">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>

          {!done && (
            <div className="p-5 sm:p-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                disabled={!files.length || parsing}
                onClick={() => void handleParse()}
                className="flex-1 py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {parsing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Scanning with
                    AI…
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" /> Scan schedule
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={!selected.length || importing || parsing}
                onClick={() => void handleImport()}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Creating loan…
                  </>
                ) : (
                  `Import ${selected.length} payments`
                )}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
