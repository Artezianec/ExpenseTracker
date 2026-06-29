import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Search,
  Package,
  Store,
  Shield,
  CreditCard,
  Receipt,
  Trash2,
  Download,
  Eye,
  Loader2,
  X,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import type { Purchase, PurchaseReceipt, InterestRatePeriod } from '../types';
import {
  addPurchaseReceipts,
  createPurchase,
  deletePurchase,
  deletePurchaseReceipt,
  fetchReceiptBlob,
  interestRateLabel,
  receiptLabel,
  subscribeToPurchases,
  updatePurchase,
  warrantyStatus,
} from '../lib/purchases';
import { formatCurrency, formatDate, formatMonthYearFromParts } from '../utils/format';
import { toDate } from '../lib/dates';

interface PurchasesViewProps {
  onSelectMonth?: (groupId: string) => void;
}

function toDateInput(iso?: string): string {
  if (!iso) return '';
  return toDate(iso).toISOString().split('T')[0];
}

export default function PurchasesView({ onSelectMonth }: PurchasesViewProps) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewMime, setPreviewMime] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [store, setStore] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [warrantyExpiresAt, setWarrantyExpiresAt] = useState('');
  const [useInstallments, setUseInstallments] = useState(false);
  const [installmentCount, setInstallmentCount] = useState('2');
  const [interestRate, setInterestRate] = useState('0');
  const [interestRatePeriod, setInterestRatePeriod] =
    useState<InterestRatePeriod>('annual');
  const [newReceipts, setNewReceipts] = useState<File[]>([]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    return subscribeToPurchases(setPurchases, console.error, debouncedSearch);
  }, [debouncedSearch]);

  useEffect(() => {
    if (!editingPurchase) return;
    const updated = purchases.find((p) => p.id === editingPurchase.id);
    if (updated) setEditingPurchase(updated);
  }, [purchases, editingPurchase?.id]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetForm = () => {
    setEditingPurchase(null);
    setName('');
    setAmount('');
    setStore('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setWarrantyExpiresAt('');
    setUseInstallments(false);
    setInstallmentCount('2');
    setInterestRate('0');
    setInterestRatePeriod('annual');
    setNewReceipts([]);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (purchase: Purchase) => {
    setEditingPurchase(purchase);
    setName(purchase.name);
    setAmount(String(purchase.amount));
    setStore(purchase.store ?? '');
    setPurchaseDate(toDateInput(purchase.purchaseDate));
    setWarrantyExpiresAt(toDateInput(purchase.warrantyExpiresAt));
    setUseInstallments(purchase.installmentCount > 1);
    setInstallmentCount(
      purchase.installmentCount > 1 ? String(purchase.installmentCount) : '2',
    );
    setInterestRate(
      purchase.interestRate != null ? String(purchase.interestRate) : '0',
    );
    setInterestRatePeriod(purchase.interestRatePeriod ?? 'annual');
    setNewReceipts([]);
    setError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    const parsedInstallments = useInstallments
      ? Math.max(2, parseInt(installmentCount, 10) || 2)
      : 1;
    const parsedRate = useInstallments
      ? Math.max(0, Number(interestRate) || 0)
      : undefined;

    if (!name.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter product name and a valid price');
      return;
    }
    if (useInstallments && parsedRate > 100) {
      setError('Interest rate must be between 0 and 100');
      return;
    }

    const payload = {
      name: name.trim(),
      amount: parsedAmount,
      store: store.trim() || undefined,
      purchaseDate: new Date(purchaseDate).toISOString(),
      warrantyExpiresAt: warrantyExpiresAt
        ? new Date(warrantyExpiresAt).toISOString()
        : undefined,
      installmentCount: parsedInstallments,
      interestRate: parsedRate,
      interestRatePeriod,
    };

    setSubmitting(true);
    setError('');
    try {
      if (editingPurchase) {
        await updatePurchase(editingPurchase.id, payload);
        if (newReceipts.length) {
          await addPurchaseReceipts(editingPurchase.id, newReceipts);
        }
      } else {
        await createPurchase({ ...payload, receipts: newReceipts });
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        'Delete this product? Scheduled payments will be removed too.',
      )
    ) {
      return;
    }
    try {
      await deletePurchase(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleDeleteReceipt = async (
    purchaseId: string,
    receipt: PurchaseReceipt,
  ) => {
    if (!window.confirm('Delete this receipt file?')) return;
    try {
      await deletePurchaseReceipt(purchaseId, receipt.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleViewReceipt = async (
    purchase: Purchase,
    receipt: PurchaseReceipt,
    index: number,
  ) => {
    try {
      const { blob, filename } = await fetchReceiptBlob(
        purchase.id,
        receipt.id,
        false,
      );
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewTitle(filename || receiptLabel(receipt, index));
      setPreviewMime(receipt.mimeType ?? blob.type ?? null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not open receipt');
    }
  };

  const handleDownloadReceipt = async (
    purchase: Purchase,
    receipt: PurchaseReceipt,
    index: number,
  ) => {
    try {
      const { blob, filename } = await fetchReceiptBlob(
        purchase.id,
        receipt.id,
        true,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        filename ||
        receiptLabel(receipt, index) ||
        `${purchase.name}-receipt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleReceiptFilesChange = (files: FileList | null) => {
    if (!files?.length) {
      setNewReceipts([]);
      return;
    }
    setNewReceipts(Array.from(files));
  };

  const previewIsImage = previewMime?.startsWith('image/') ?? false;

  const paymentDetailsBlock = (purchase: Purchase) => (
    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
        <CreditCard className="w-4 h-4" />
        {purchase.installmentCount > 1 ? 'Payment plan' : 'Cost'}
      </p>

      {purchase.installmentCount > 1 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
                Product price
              </p>
              <p className="font-bold text-zinc-900 dark:text-white">
                {formatCurrency(purchase.amount)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
                {interestRateLabel(purchase.interestRatePeriod ?? 'annual')}
              </p>
              <p className="font-bold text-zinc-900 dark:text-white">
                {(purchase.interestRate ?? 0).toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
                Payments
              </p>
              <p className="font-bold text-zinc-900 dark:text-white">
                {purchase.installmentCount} months
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
                Total with interest
              </p>
              <p className="font-bold text-indigo-600 dark:text-indigo-400">
                {formatCurrency(purchase.totalScheduled ?? purchase.amount)}
              </p>
            </div>
          </div>

          {(purchase.totalInterest ?? 0) > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Interest: {formatCurrency(purchase.totalInterest ?? 0)} on top of
              product price
            </p>
          )}

          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
            Schedule (from next month)
          </p>
          <div className="space-y-2">
            {purchase.installments.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => onSelectMonth?.(inst.groupId)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-zinc-900 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 hover:border-indigo-400 transition-colors text-left"
              >
                <span className="text-zinc-600 dark:text-zinc-300">
                  #{inst.installmentNumber} ·{' '}
                  {formatMonthYearFromParts(inst.month, inst.year)}
                </span>
                <span className="font-bold font-mono text-indigo-600 dark:text-indigo-400 shrink-0">
                  {formatCurrency(inst.amount)}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-lg font-bold text-zinc-900 dark:text-white">
          {formatCurrency(purchase.amount)}
        </p>
      )}
    </div>
  );

  const warrantyBadge = (purchase: Purchase) => {
    const status = warrantyStatus(purchase.warrantyExpiresAt);
    if (status === 'none') return null;
    const labels = {
      active: 'Warranty active',
      expiring: 'Warranty expiring soon',
      expired: 'Warranty expired',
    };
    const colors = {
      active:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      expiring:
        'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      expired: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${colors[status]}`}
      >
        {status === 'expiring' && <AlertTriangle className="w-3 h-3" />}
        <Shield className="w-3 h-3" />
        {labels[status]}
        {purchase.warrantyExpiresAt && (
          <span className="opacity-80">
            · {formatDate(toDate(purchase.warrantyExpiresAt))}
          </span>
        )}
      </span>
    );
  };

  const receiptActions = (
    purchase: Purchase,
    receipt: PurchaseReceipt,
    index: number,
    compact = false,
  ) => (
    <div
      key={receipt.id}
      className={`flex items-center gap-2 ${compact ? '' : 'p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-700'}`}
    >
      <Receipt className="w-4 h-4 text-zinc-400 shrink-0" />
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate flex-1 min-w-0">
        {receiptLabel(receipt, index)}
      </span>
      <button
        type="button"
        onClick={() => handleViewReceipt(purchase, receipt, index)}
        className="p-2 text-zinc-400 hover:text-indigo-600 rounded-lg transition-colors"
        title="View"
      >
        <Eye className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => handleDownloadReceipt(purchase, receipt, index)}
        className="p-2 text-zinc-400 hover:text-indigo-600 rounded-lg transition-colors"
        title="Download"
      >
        <Download className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => handleDeleteReceipt(purchase.id, receipt)}
        className="p-2 text-zinc-400 hover:text-red-600 rounded-lg transition-colors"
        title="Delete receipt"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white font-display flex items-center gap-3">
            <Package className="w-8 h-8 text-indigo-500" />
            Products & Receipts
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2 text-sm">
            Track purchases, warranties, receipts, and installment payments
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product name or store..."
          className="w-full pl-12 pr-4 py-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
      </div>

      {purchases.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 p-16 text-center">
          <Package className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-500 font-medium">
            {debouncedSearch
              ? 'No products match your search'
              : 'No products yet — add your first purchase'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {purchases.map((purchase) => (
            <motion.div
              key={purchase.id}
              layout
              className="bg-white dark:bg-zinc-900 rounded-[32px] border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 shadow-xl shadow-zinc-200/50 dark:shadow-black/20"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                      {purchase.name}
                    </h2>
                    {warrantyBadge(purchase)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
                    <span className="flex items-center gap-1.5">
                      <Store className="w-4 h-4" />
                      {purchase.store || '—'}
                    </span>
                    <span>
                      Purchased {formatDate(toDate(purchase.purchaseDate))}
                    </span>
                  </div>

                  {purchase.receipts.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                        Receipts ({purchase.receipts.length})
                      </p>
                      {purchase.receipts.map((receipt, index) =>
                        receiptActions(purchase, receipt, index),
                      )}
                    </div>
                  )}

                  {paymentDetailsBlock(purchase)}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {purchase.receipts.length === 0 && (
                    <span className="text-xs text-zinc-400 flex items-center gap-1 px-3">
                      <Receipt className="w-4 h-4" />
                      No receipts
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => openEdit(purchase)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(purchase.id)}
                    className="p-2.5 rounded-xl text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete product"
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
                  {editingPurchase ? 'Edit Product' : 'Add Product'}
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
                    Product name
                  </label>
                  <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Price
                    </label>
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Store
                    </label>
                    <input
                      value={store}
                      onChange={(e) => setStore(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Purchase date
                    </label>
                    <input
                      required
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Warranty until
                    </label>
                    <input
                      type="date"
                      value={warrantyExpiresAt}
                      onChange={(e) => setWarrantyExpiresAt(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  </div>
                </div>
                <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useInstallments}
                      onChange={(e) => setUseInstallments(e.target.checked)}
                      className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                      Split into monthly payments
                    </span>
                  </label>
                  {useInstallments && (
                    <div className="space-y-3">
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
                                ? 'bg-indigo-600 text-white border-indigo-600'
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
                                ? 'bg-indigo-600 text-white border-indigo-600'
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
                            Number of payments
                          </label>
                          <input
                            type="number"
                            min="2"
                            max="60"
                            value={installmentCount}
                            onChange={(e) => setInstallmentCount(e.target.value)}
                            className="w-full px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
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
                            className="w-full px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  {useInstallments && (
                    <p className="text-xs text-zinc-500">
                      In Israel loans are usually quoted as annual rate (ribit
                      shnatit). Payments start from the next month. 0% = equal
                      split without interest.
                    </p>
                  )}
                  {editingPurchase && useInstallments && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Changing price, date, payment count, or interest rate
                      will recalculate scheduled months.
                    </p>
                  )}
                </div>

                {editingPurchase && editingPurchase.receipts.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
                      Existing receipts
                    </label>
                    {editingPurchase.receipts.map((receipt, index) =>
                      receiptActions(editingPurchase, receipt, index, true),
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    {editingPurchase ? 'Add more receipts' : 'Receipts'} (PDF,
                    JPG, PNG — multiple allowed)
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp,image/*,application/pdf"
                    onChange={(e) => handleReceiptFilesChange(e.target.files)}
                    className="w-full text-sm text-zinc-600 dark:text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-900/30 dark:file:text-indigo-300 file:font-bold"
                  />
                  {newReceipts.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {newReceipts.map((file) => (
                        <li
                          key={`${file.name}-${file.size}`}
                          className="text-xs text-zinc-500 truncate"
                        >
                          {file.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : editingPurchase ? (
                    <Pencil className="w-5 h-5" />
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                  {editingPurchase ? 'Save changes' : 'Save product'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewUrl && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
              className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-[32px] border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
                <p className="font-bold text-zinc-900 dark:text-white truncate">
                  {previewTitle}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }}
                  className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-[300px]">
                {previewIsImage ? (
                  <img
                    src={previewUrl}
                    alt={previewTitle}
                    className="max-w-full max-h-[70vh] object-contain rounded-lg"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    title={previewTitle}
                    className="w-full h-[70vh] rounded-lg border border-zinc-200 dark:border-zinc-700"
                  />
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
