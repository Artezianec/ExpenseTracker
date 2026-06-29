import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  Trash2,
  CheckSquare,
  Square,
  Loader2,
  X,
} from 'lucide-react';
import { Group } from '../types';
import { deleteGroup } from '../lib/budgetDb';
import { formatCurrency, formatMonthYearFromParts } from '../utils/format';

interface MonthsSidebarProps {
  groups: Group[];
  selectedGroupId: string | null;
  userId: string;
  onSelectGroup: (id: string) => void;
  onCreateMonth: () => void;
}

function hasMonthDetails(group: Group): boolean {
  return (
    (group.installments?.length ?? 0) > 0 ||
    (group.creditPayments?.length ?? 0) > 0 ||
    (group.insurancePayments?.length ?? 0) > 0 ||
    (group.shoppingTrips?.length ?? 0) > 0
  );
}

function loadCollapsedIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`collapsedMonths_${userId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedIds(userId: string, ids: Set<string>) {
  localStorage.setItem(
    `collapsedMonths_${userId}`,
    JSON.stringify(Array.from(ids)),
  );
}

export default function MonthsSidebar({
  groups,
  selectedGroupId,
  userId,
  onSelectGroup,
  onCreateMonth,
}: MonthsSidebarProps) {
  const [monthSearch, setMonthSearch] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    loadCollapsedIds(userId),
  );
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteModalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsedIds(loadCollapsedIds(userId));
  }, [userId]);

  useEffect(() => {
    if (isDeleteConfirmOpen && deleteModalRef.current) {
      deleteModalRef.current.focus();
    }
  }, [isDeleteConfirmOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDeleteConfirmOpen(false);
        if (selectionMode) {
          setSelectionMode(false);
          setSelectedIds(new Set());
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionMode]);

  const filteredGroups = useMemo(() => {
    const q = monthSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      const nameMatch = g.name.toLowerCase().includes(q);
      const monthLabel = formatMonthYearFromParts(g.month, g.year).toLowerCase();
      return nameMatch || monthLabel.includes(q);
    });
  }, [groups, monthSearch]);

  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedIds.has(g.id)),
    [groups, selectedIds],
  );

  const toggleCollapsed = (groupId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      saveCollapsedIds(userId, next);
      return next;
    });
  };

  const toggleSelected = (groupId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredGroups.map((g) => g.id);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => deleteGroup(id)),
      );
      setIsDeleteConfirmOpen(false);
      exitSelectionMode();
    } catch (error) {
      console.error('Failed to delete months:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const allFilteredSelected =
    filteredGroups.length > 0 &&
    filteredGroups.every((g) => selectedIds.has(g.id));

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-2 relative z-10 custom-scrollbar min-h-[200px]">
        <div className="px-2 mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <input
              type="search"
              value={monthSearch}
              onChange={(e) => setMonthSearch(e.target.value)}
              placeholder="Search months..."
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
          </div>
        </div>

        <div className="flex items-center justify-between px-4 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
            Your Months
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (selectionMode) {
                  exitSelectionMode();
                } else {
                  setSelectionMode(true);
                }
              }}
              title={selectionMode ? 'Cancel selection' : 'Select months'}
              className={`p-1.5 rounded-lg transition-colors ${
                selectionMode
                  ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                  : 'hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onCreateMonth}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-lg transition-colors text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              title="Create new month"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {selectionMode && (
          <div className="mx-2 mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10">
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
            >
              {allFilteredSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-xs text-zinc-500 flex-1 text-center">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setIsDeleteConfirmOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-700 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={exitSelectionMode}
              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-white"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="space-y-1">
          {filteredGroups.map((group) => {
            const isSelected = selectedGroupId === group.id;
            const isChecked = selectedIds.has(group.id);
            const expanded = !collapsedIds.has(group.id);
            const showDetails = hasMonthDetails(group);

            return (
              <div
                key={group.id}
                className={`rounded-xl transition-all duration-300 ${
                  isSelected && !selectionMode
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                    : isChecked && selectionMode
                      ? 'bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-300 dark:ring-indigo-500/40'
                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                <div className="flex items-stretch">
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={() => toggleSelected(group.id)}
                      className="pl-3 pr-1 py-3 flex items-center shrink-0"
                      aria-label={isChecked ? 'Deselect month' : 'Select month'}
                    >
                      {isChecked ? (
                        <CheckSquare
                          className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}`}
                        />
                      ) : (
                        <Square className="w-4 h-4 opacity-50" />
                      )}
                    </button>
                  )}

                  {showDetails && (
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(group.id)}
                      className={`pr-1 py-3 flex items-center shrink-0 ${selectionMode ? 'pl-1' : 'pl-3'}`}
                      aria-label={expanded ? 'Collapse month' : 'Expand month'}
                      title={expanded ? 'Collapse' : 'Expand'}
                    >
                      {expanded ? (
                        <ChevronUp
                          className={`w-4 h-4 opacity-70 ${isSelected && !selectionMode ? 'text-white' : ''}`}
                        />
                      ) : (
                        <ChevronDown
                          className={`w-4 h-4 opacity-70 ${isSelected && !selectionMode ? 'text-white' : ''}`}
                        />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelected(group.id);
                      } else {
                        onSelectGroup(group.id);
                      }
                    }}
                    className={`flex-1 flex flex-col items-stretch py-3 pr-4 min-w-0 ${
                      !showDetails && !selectionMode ? 'pl-4' : showDetails && !selectionMode ? 'pl-1' : 'pl-1'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full shrink-0 transition-transform bg-indigo-400" />
                        <span className="truncate text-sm font-medium text-left">
                          {group.name}
                        </span>
                      </div>
                      {isSelected && !selectionMode && (
                        <ChevronRight className="w-4 h-4 opacity-70 shrink-0" />
                      )}
                    </div>

                    {expanded && group.installments && group.installments.length > 0 && (
                      <div className="mt-2 ml-5 space-y-1 text-left">
                        {group.installments.map((inst) => (
                          <p
                            key={inst.id}
                            className={`text-[10px] truncate ${
                              isSelected && !selectionMode
                                ? 'text-indigo-100'
                                : 'text-zinc-400 dark:text-zinc-500'
                            }`}
                          >
                            {inst.purchaseName}: {formatCurrency(inst.amount)}
                          </p>
                        ))}
                      </div>
                    )}
                    {expanded && group.shoppingTrips && group.shoppingTrips.length > 0 && (
                      <div className="mt-2 ml-5 space-y-1 text-left">
                        {group.shoppingTrips.map((trip) => (
                          <p
                            key={trip.id}
                            className={`text-[10px] truncate ${
                              isSelected && !selectionMode
                                ? 'text-emerald-100'
                                : 'text-emerald-600/70 dark:text-emerald-500/70'
                            }`}
                          >
                            {trip.storeName ?? 'Store'}:{' '}
                            {formatCurrency(trip.totalAmount)}
                          </p>
                        ))}
                      </div>
                    )}
                    {expanded && group.creditPayments && group.creditPayments.length > 0 && (
                      <div className="mt-2 ml-5 space-y-1 text-left">
                        {group.creditPayments.map((cp) => (
                          <p
                            key={cp.id}
                            className={`text-[10px] truncate ${
                              isSelected && !selectionMode
                                ? 'text-emerald-100'
                                : 'text-emerald-600/70 dark:text-emerald-500/70'
                            }`}
                          >
                            {cp.creditName}: {formatCurrency(cp.amount)}
                          </p>
                        ))}
                      </div>
                    )}
                    {expanded &&
                      group.insurancePayments &&
                      group.insurancePayments.length > 0 && (
                        <div className="mt-2 ml-5 space-y-1 text-left">
                          {group.insurancePayments.map((ip) => (
                            <p
                              key={ip.id}
                              className={`text-[10px] truncate ${
                                isSelected && !selectionMode
                                  ? 'text-sky-100'
                                  : 'text-sky-600/70 dark:text-sky-500/70'
                              }`}
                            >
                              {ip.insuranceName}: {formatCurrency(ip.amount)}
                            </p>
                          ))}
                        </div>
                      )}
                  </button>
                </div>
              </div>
            );
          })}

          {groups.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">
                No months yet
              </p>
            </div>
          )}

          {groups.length > 0 && filteredGroups.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">
                No months match your search
              </p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isDeleteConfirmOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setIsDeleteConfirmOpen(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              ref={deleteModalRef}
              tabIndex={-1}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="bulk-delete-title"
              aria-describedby="bulk-delete-desc"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[40px] shadow-2xl p-10 text-center outline-none"
            >
              <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">
                <Trash2 className="w-10 h-10" />
              </div>
              <h3
                id="bulk-delete-title"
                className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-3 font-display"
              >
                Delete {selectedIds.size} month{selectedIds.size !== 1 ? 's' : ''}?
              </h3>
              <p
                id="bulk-delete-desc"
                className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 leading-relaxed"
              >
                This will permanently delete the selected months and all their
                expenses. This action cannot be undone.
              </p>
              <ul className="text-left text-sm text-zinc-600 dark:text-zinc-300 mb-8 max-h-32 overflow-y-auto space-y-1 px-2">
                {selectedGroups.map((g) => (
                  <li key={g.id} className="truncate">
                    • {g.name}
                  </li>
                ))}
              </ul>
              <div className="flex gap-4">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  className="flex-1 py-4 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-2xl font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleBulkDelete}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 dark:shadow-red-500/20 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
