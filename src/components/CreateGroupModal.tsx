import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar } from 'lucide-react';
import { AppUser } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { createGroup } from '../lib/budgetDb';
import { handleDbError, OperationType } from '../utils/errorHandling';
import { CURRENCY_SYMBOL, MONTH_OPTIONS, yearOptions } from '../utils/format';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AppUser;
}

export default function CreateGroupModal({ isOpen, onClose, user }: CreateGroupModalProps) {
  const { accessToken } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [maxBudget, setMaxBudget] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !accessToken) return;

    setIsSubmitting(true);
    setError('');
    try {
      await createGroup(user, {
        month,
        year,
        ...(maxBudget && !isNaN(parseFloat(maxBudget))
          ? { maxBudget: parseFloat(maxBudget) }
          : {}),
      });
      onClose();
      setMaxBudget('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create month';
      if (msg.includes('month already exists')) {
        setError('This month already exists');
      } else {
        handleDbError(err, OperationType.CREATE, 'groups', user.uid);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl overflow-y-auto max-h-[90vh] outline-none"
            tabIndex={-1}
          >
            <div className="p-10">
              <div className="flex items-center justify-between mb-10">
                <h2 id="modal-title" className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white font-display flex items-center gap-3">
                  <Calendar className="w-8 h-8 text-indigo-600" />
                  New Month
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400"
                  aria-label="Close"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="month" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 font-display">Month</label>
                    <select
                      id="month"
                      value={month}
                      onChange={(e) => setMonth(Number(e.target.value))}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 font-medium dark:text-white"
                      required
                    >
                      {MONTH_OPTIONS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="year" className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-3 font-display">Year</label>
                    <select
                      id="year"
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value))}
                      className="w-full px-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 font-medium dark:text-white"
                      required
                    >
                      {yearOptions().map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="max-budget" className="block text-[10px] font-bold text-zinc-500 mb-3 uppercase tracking-wider font-display">Max Budget (optional)</label>
                  <div className="relative">
                    <span className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 font-bold">{CURRENCY_SYMBOL}</span>
                    <input
                      id="max-budget"
                      type="number"
                      step="0.01"
                      value={maxBudget}
                      onChange={(e) => setMaxBudget(e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-10 pr-5 py-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 font-mono font-bold dark:text-white"
                    />
                  </div>
                </div>

                {error ? (
                  <p className="text-sm text-red-500">{error}</p>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting || !accessToken}
                  className="w-full py-5 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl font-bold hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 shadow-xl shadow-indigo-500/20 active:scale-[0.98]"
                >
                  {isSubmitting ? 'Creating...' : 'Create Month'}
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
