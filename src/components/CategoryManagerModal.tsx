import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Pencil, Tag, Loader2 } from 'lucide-react';
import { useCategories } from '../contexts/CategoriesContext';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CategoryManagerModal({
  isOpen,
  onClose,
}: CategoryManagerModalProps) {
  const { categories, createCategory, updateCategory, deleteCategory } =
    useCategories();
  const [newName, setNewName] = useState('');
  const [newPriority, setNewPriority] = useState(3);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPriority, setEditPriority] = useState(3);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const priorityLabel = (p: number) =>
    `${p} — ${p <= 1 ? 'critical' : p <= 2 ? 'high' : p <= 3 ? 'medium' : p <= 4 ? 'low' : 'minimal'}`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createCategory(newName.trim(), newPriority);
      setNewName('');
      setNewPriority(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (id: string, name: string, priority: number) => {
    setEditingId(id);
    setEditName(name);
    setEditPriority(priority);
    setError('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await updateCategory(id, {
        name: editName.trim(),
        priority: editPriority,
      });
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSubmitting(true);
    setError('');
    try {
      await deleteCategory(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="categories-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[32px] shadow-2xl max-h-[90vh] overflow-hidden flex flex-col outline-none"
          >
            <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <div className="flex items-center justify-between">
                <h2
                  id="categories-title"
                  className="text-2xl font-bold text-zinc-900 dark:text-white font-display flex items-center gap-2"
                >
                  <Tag className="w-6 h-6 text-indigo-600" />
                  Categories
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full"
                >
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>
              <p className="text-sm text-zinc-500 mt-2">
                Priority 1–5 (1 = most important). Sorted by priority in expense forms.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {error ? (
                <p className="text-sm text-red-500">{error}</p>
              ) : null}

              <div className="space-y-3">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
                  >
                    {editingId === cat.id ? (
                      <div className="space-y-3">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full px-4 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 dark:text-white"
                        />
                        <select
                          value={editPriority}
                          onChange={(e) =>
                            setEditPriority(Number(e.target.value))
                          }
                          className="w-full px-4 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 dark:text-white"
                        >
                          {[1, 2, 3, 4, 5].map((p) => (
                            <option key={p} value={p}>
                              {priorityLabel(p)}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(cat.id)}
                            disabled={submitting}
                            className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 rounded-xl text-sm font-bold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-900 dark:text-white truncate">
                            {cat.name}
                          </p>
                          <p className="text-xs text-zinc-500">
                            Priority {cat.priority}/5
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                            {cat.priority}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              startEdit(cat.id, cat.name, cat.priority)
                            }
                            className="p-2 text-zinc-400 hover:text-indigo-600 rounded-lg"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(cat.id)}
                            disabled={submitting}
                            className="p-2 text-zinc-400 hover:text-red-600 rounded-lg"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <form onSubmit={handleAdd} className="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  Add category
                </p>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Category name"
                  className="w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 dark:text-white"
                />
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 dark:text-white"
                >
                  {[1, 2, 3, 4, 5].map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={submitting || !newName.trim()}
                  className="w-full py-3 bg-zinc-900 dark:bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
