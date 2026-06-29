import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileUp,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  commitExpenseImport,
  parseExpensePdfs,
  type ImportExpenseItem,
  type ParseImportResult,
} from '../lib/expense-import';
import { formatCurrency, formatMonthYearFromParts } from '../utils/format';

interface ExpenseImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryNames: string[];
  onComplete?: () => void;
}

function monthKey(item: ImportExpenseItem) {
  return `${item.year}-${String(item.month).padStart(2, '0')}`;
}

export default function ExpenseImportModal({
  isOpen,
  onClose,
  categoryNames,
  onComplete,
}: ExpenseImportModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<ImportExpenseItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filesSummary, setFilesSummary] = useState<
    ParseImportResult['filesSummary']
  >([]);
  const [allComplete, setAllComplete] = useState<boolean | null>(null);
  const [aiReviewedCount, setAiReviewedCount] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ created: number; months: string[] } | null>(
    null,
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ImportExpenseItem[]>();
    for (const item of items) {
      const k = monthKey(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const selectedCount = items.filter((i) => i.selected).length;
  const selectedTotal = items
    .filter((i) => i.selected)
    .reduce((s, i) => s + i.amount, 0);

  const reset = () => {
    setFiles([]);
    setItems([]);
    setWarnings([]);
    setFilesSummary([]);
    setAllComplete(null);
    setAiReviewedCount(null);
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
      const result = await parseExpensePdfs(files);
      setItems(result.items);
      setWarnings(result.warnings);
      setFilesSummary(result.filesSummary);
      setAllComplete(result.allComplete ?? null);
      setAiReviewedCount(result.aiReviewedCount ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    const selected = items.filter((i) => i.selected);
    if (!selected.length) return;
    setImporting(true);
    setError('');
    try {
      const result = await commitExpenseImport(selected);
      setDone({ created: result.created, months: result.months });
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const updateItem = (id: string, patch: Partial<ImportExpenseItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
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
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white font-display">
                Import expenses from PDF
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Bank statements, bills, payment confirmations — AI assigns categories
                and budget months before import
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
                  Imported {done.created} expenses
                </p>
                <p className="text-sm text-zinc-500">
                  Months: {done.months.join(', ') || '—'}
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-4 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <label className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/5">
                  <FileUp className="w-10 h-10 text-indigo-500" />
                  <span className="font-bold text-sm text-zinc-700 dark:text-zinc-300">
                    Select PDF files (multiple OK)
                  </span>
                  <span className="text-xs text-zinc-500 text-center">
                    e.g. bank statement, water, electricity, arnona, bill
                    confirmations
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      setFiles([...(e.target.files ?? [])]);
                      setItems([]);
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

                {filesSummary.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {filesSummary.map((f) => (
                        <span
                          key={f.name}
                          className={`text-xs px-2 py-1 rounded-lg ${
                            f.complete
                              ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                              : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {f.name}: {f.count} expense
                          {f.count === 1 ? '' : 's'}
                          {f.skippedCredits > 0
                            ? ` · ${f.skippedCredits} income skipped`
                            : ''}
                          {f.complete ? ' · complete' : ' · review warnings'}
                        </span>
                      ))}
                    </div>
                    {allComplete === true && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 flex gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        All PDF rows extracted (bank income/credits excluded).
                      </p>
                    )}
                    {aiReviewedCount != null && aiReviewedCount > 0 && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400">
                        AI categorized {aiReviewedCount} expense
                        {aiReviewedCount === 1 ? '' : 's'} for database import.
                      </p>
                    )}
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
                        Preview — {selectedCount} selected (
                        {formatCurrency(selectedTotal)})
                      </span>
                      <button
                        type="button"
                        className="text-indigo-600 text-xs font-bold"
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((i) => ({ ...i, selected: true })),
                          )
                        }
                      >
                        Select all
                      </button>
                    </div>

                    {grouped.map(([key, monthItems]) => {
                      const [y, m] = key.split('-').map(Number);
                      return (
                        <div key={key} className="space-y-2">
                          <h3 className="text-sm font-black text-indigo-600 dark:text-indigo-400 sticky top-0 bg-white dark:bg-zinc-900 py-1">
                            {formatMonthYearFromParts(m, y)} ({monthItems.length})
                          </h3>
                          <div className="space-y-1">
                            {monthItems.map((item) => (
                              <div
                                key={item.id}
                                className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-xl text-sm border ${
                                  item.selected
                                    ? 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5'
                                    : 'border-transparent opacity-50'
                                }`}
                              >
                                <label className="flex items-center gap-2 shrink-0">
                                  <input
                                    type="checkbox"
                                    checked={item.selected}
                                    onChange={(e) =>
                                      updateItem(item.id, {
                                        selected: e.target.checked,
                                      })
                                    }
                                  />
                                  <span className="font-mono text-xs text-zinc-500 w-20">
                                    {item.date}
                                  </span>
                                </label>
                                <p className="flex-1 min-w-0 truncate font-medium">
                                  {item.description}
                                </p>
                                <select
                                  value={item.category}
                                  onChange={(e) =>
                                    updateItem(item.id, {
                                      category: e.target.value,
                                    })
                                  }
                                  className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 max-w-[120px]"
                                >
                                  {categoryNames.map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                                <span className="font-bold text-right sm:w-20 shrink-0">
                                  {formatCurrency(item.amount)}
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
                    <Loader2 className="w-4 h-4 animate-spin" /> Parsing &amp; AI
                    categorizing…
                  </>
                ) : (
                  <>
                    <FileUp className="w-4 h-4" /> Parse with AI
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={!selectedCount || importing || parsing}
                onClick={() => void handleImport()}
                className="flex-1 py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Importing…
                  </>
                ) : (
                  `Import ${selectedCount} to months`
                )}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
