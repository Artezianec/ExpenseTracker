import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Shield,
  Trash2,
  Loader2,
  X,
  Pencil,
  Calendar,
  FileText,
  Eye,
  Download,
  User,
  Package,
} from 'lucide-react';
import type {
  HouseholdMember,
  Insurance,
  InsuranceContract,
  InsuranceSubjectType,
  Purchase,
} from '../types';
import {
  addInsuranceContracts,
  contractLabel,
  createInsurance,
  deleteInsurance,
  deleteInsuranceContract,
  fetchContractBlob,
  subjectTypeLabel,
  subscribeToInsurances,
  updateInsurance,
} from '../lib/insurances';
import { listHouseholdMembers } from '../lib/household';
import { listPurchases } from '../lib/purchases';
import { formatCurrency, formatDate, formatMonthYearFromParts } from '../utils/format';
import { toDate } from '../lib/dates';

interface InsurancesViewProps {
  onSelectMonth?: (groupId: string) => void;
}

function toDateInput(iso?: string): string {
  if (!iso) return '';
  return toDate(iso).toISOString().split('T')[0];
}

export default function InsurancesView({ onSelectMonth }: InsurancesViewProps) {
  const [insurances, setInsurances] = useState<Insurance[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Insurance | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [newContracts, setNewContracts] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewMime, setPreviewMime] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [subjectType, setSubjectType] =
    useState<InsuranceSubjectType>('person');
  const [subjectUserId, setSubjectUserId] = useState('');
  const [subjectPurchaseId, setSubjectPurchaseId] = useState('');
  const [subjectLabel, setSubjectLabel] = useState('');
  const [paymentDay, setPaymentDay] = useState('1');
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [endDate, setEndDate] = useState('');

  useEffect(() => subscribeToInsurances(setInsurances, console.error), []);

  useEffect(() => {
    void listHouseholdMembers().then(setMembers).catch(console.error);
    void listPurchases().then(setPurchases).catch(console.error);
  }, []);

  useEffect(() => {
    if (!editing) return;
    const updated = insurances.find((i) => i.id === editing.id);
    if (updated) setEditing(updated);
  }, [insurances, editing?.id]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetForm = () => {
    setEditing(null);
    setName('');
    setCompany('');
    setMonthlyAmount('');
    setSubjectType('person');
    setSubjectUserId('');
    setSubjectPurchaseId('');
    setSubjectLabel('');
    setPaymentDay('1');
    setStartDate(new Date().toISOString().split('T')[0]);
    setEndDate('');
    setNewContracts([]);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    if (members.length) setSubjectUserId(members[0].userId);
    setIsModalOpen(true);
  };

  const openEdit = (insurance: Insurance) => {
    setEditing(insurance);
    setName(insurance.name);
    setCompany(insurance.company);
    setMonthlyAmount(String(insurance.monthlyAmount));
    setSubjectType(insurance.subjectType);
    setSubjectUserId(insurance.subjectUserId ?? '');
    setSubjectPurchaseId(insurance.subjectPurchaseId ?? '');
    setSubjectLabel(insurance.subjectLabel ?? '');
    setPaymentDay(String(insurance.paymentDay));
    setStartDate(toDateInput(insurance.startDate));
    setEndDate(toDateInput(insurance.endDate));
    setNewContracts([]);
    setError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const buildPayload = () => {
    const amount = Number(monthlyAmount);
    const day = Math.min(28, Math.max(1, parseInt(paymentDay, 10) || 1));
    if (!company.trim() || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('Enter company and a valid monthly amount');
    }
    return {
      name: name.trim() || undefined,
      company: company.trim(),
      monthlyAmount: amount,
      subjectType,
      subjectUserId: subjectType === 'person' ? subjectUserId : undefined,
      subjectPurchaseId:
        subjectType === 'purchase' ? subjectPurchaseId : undefined,
      subjectLabel: subjectType === 'other' ? subjectLabel.trim() : undefined,
      paymentDay: day,
      startDate: new Date(startDate).toISOString(),
      endDate: endDate ? new Date(endDate).toISOString() : undefined,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = buildPayload();
      let saved: Insurance;
      if (editing) {
        saved = await updateInsurance(editing.id, payload);
        if (newContracts.length) {
          saved = await addInsuranceContracts(editing.id, newContracts);
        }
      } else {
        saved = await createInsurance(payload);
        if (newContracts.length) {
          saved = await addInsuranceContracts(saved.id, newContracts);
        }
      }
      void saved;
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save insurance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        'Delete this insurance? Scheduled payments will be removed from months.',
      )
    ) {
      return;
    }
    try {
      await deleteInsurance(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleViewContract = async (
    insurance: Insurance,
    contract: InsuranceContract,
    index: number,
  ) => {
    try {
      const { blob, filename } = await fetchContractBlob(
        insurance.id,
        contract.id,
      );
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewTitle(filename || contractLabel(contract, index));
      setPreviewMime(contract.mimeType ?? blob.type ?? null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not open contract');
    }
  };

  const handleDownloadContract = async (
    insurance: Insurance,
    contract: InsuranceContract,
    index: number,
  ) => {
    try {
      const { blob, filename } = await fetchContractBlob(
        insurance.id,
        contract.id,
        true,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        filename || contractLabel(contract, index) || `${insurance.name}-contract`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleDeleteContract = async (
    insuranceId: string,
    contract: InsuranceContract,
  ) => {
    if (!window.confirm('Delete this contract file?')) return;
    try {
      await deleteInsuranceContract(insuranceId, contract.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const contractActions = (
    insurance: Insurance,
    contract: InsuranceContract,
    index: number,
  ) => (
    <div
      key={contract.id}
      className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl text-sm"
    >
      <span className="truncate text-zinc-700 dark:text-zinc-300">
        <FileText className="w-4 h-4 inline mr-1.5 text-sky-500" />
        {contractLabel(contract, index)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => handleViewContract(insurance, contract, index)}
          className="p-1.5 text-zinc-400 hover:text-sky-600 rounded-lg"
          title="View"
        >
          <Eye className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => handleDownloadContract(insurance, contract, index)}
          className="p-1.5 text-zinc-400 hover:text-sky-600 rounded-lg"
          title="Download"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => handleDeleteContract(insurance.id, contract)}
          className="p-1.5 text-zinc-400 hover:text-red-600 rounded-lg"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const paymentBlock = (insurance: Insurance) => (
    <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-700 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
        <Shield className="w-4 h-4" />
        Monthly premium schedule
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Monthly
          </p>
          <p className="font-bold text-sky-600 dark:text-sky-400">
            {formatCurrency(insurance.monthlyAmount)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Debit day
          </p>
          <p className="font-bold text-zinc-900 dark:text-white">
            {insurance.paymentDay}th
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-400 mb-0.5">
            Covers
          </p>
          <p className="font-bold text-zinc-900 dark:text-white truncate">
            {insurance.subjectDisplayName}
          </p>
        </div>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
        {insurance.payments.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectMonth?.(p.groupId)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-zinc-900 rounded-xl text-sm border border-zinc-200 dark:border-zinc-700 hover:border-sky-400 transition-colors text-left"
          >
            <span className="text-zinc-600 dark:text-zinc-300">
              #{p.paymentNumber} · {formatMonthYearFromParts(p.month, p.year)}
            </span>
            <span className="font-bold font-mono text-sky-600 dark:text-sky-400 shrink-0">
              {formatCurrency(p.amount)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white font-display flex items-center gap-3">
            <Shield className="w-8 h-8 text-sky-500" />
            Insurance
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2 text-sm">
            Policies for people or products — monthly premiums in your budget months
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-sky-600 text-white rounded-2xl text-sm font-bold hover:bg-sky-700 transition-all shadow-lg shadow-sky-500/20 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Add Insurance
        </button>
      </div>

      {insurances.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-[40px] border border-zinc-200 dark:border-zinc-800 p-16 text-center">
          <Shield className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
          <p className="text-zinc-500 font-medium">No insurance policies yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {insurances.map((insurance) => (
            <motion.div
              key={insurance.id}
              layout
              className="bg-white dark:bg-zinc-900 rounded-[32px] border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 shadow-xl shadow-zinc-200/50 dark:shadow-black/20"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-1">
                    {insurance.name}
                  </h2>
                  <p className="text-sm font-bold text-sky-600 dark:text-sky-400 mb-2">
                    {insurance.company}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
                    <span className="flex items-center gap-1.5">
                      {insurance.subjectType === 'person' ? (
                        <User className="w-4 h-4" />
                      ) : insurance.subjectType === 'purchase' ? (
                        <Package className="w-4 h-4" />
                      ) : (
                        <Shield className="w-4 h-4" />
                      )}
                      {subjectTypeLabel(insurance.subjectType)}:{' '}
                      {insurance.subjectDisplayName}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      From {formatDate(toDate(insurance.startDate))}
                      {insurance.endDate &&
                        ` · until ${formatDate(toDate(insurance.endDate))}`}
                    </span>
                  </div>
                  {insurance.contracts.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        Contracts ({insurance.contracts.length})
                      </p>
                      {insurance.contracts.map((c, i) =>
                        contractActions(insurance, c, i),
                      )}
                    </div>
                  )}
                  {paymentBlock(insurance)}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(insurance)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(insurance.id)}
                    className="p-2.5 rounded-xl text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete"
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
                  {editing ? 'Edit Insurance' : 'Add Insurance'}
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
                    Insurance company
                  </label>
                  <input
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Harel, Migdal"
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Policy name (optional)
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Monthly payment (₪)
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={monthlyAmount}
                    onChange={(e) => setMonthlyAmount(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Covers
                  </label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {(
                      [
                        ['person', 'Person'],
                        ['purchase', 'Product'],
                        ['other', 'Other'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSubjectType(value)}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-colors ${
                          subjectType === value
                            ? 'bg-sky-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {subjectType === 'person' && (
                    <select
                      required
                      value={subjectUserId}
                      onChange={(e) => setSubjectUserId(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white"
                    >
                      <option value="">Select household member</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName ?? m.email}
                        </option>
                      ))}
                    </select>
                  )}
                  {subjectType === 'purchase' && (
                    <select
                      required
                      value={subjectPurchaseId}
                      onChange={(e) => setSubjectPurchaseId(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white"
                    >
                      <option value="">Select product</option>
                      {purchases.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.store ? ` (${p.store})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {subjectType === 'other' && (
                    <input
                      required
                      value={subjectLabel}
                      onChange={(e) => setSubjectLabel(e.target.value)}
                      placeholder="e.g. Apartment, Business liability"
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Payment day
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={paymentDay}
                      onChange={(e) => setPaymentDay(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                      Start date
                    </label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    End date (optional)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-white"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Leave empty to schedule 24 months ahead
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
                    Contract photos / PDF
                  </label>
                  {editing && editing.contracts.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {editing.contracts.map((c, i) =>
                        contractActions(editing, c, i),
                      )}
                    </div>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    multiple
                    onChange={(e) =>
                      setNewContracts(Array.from(e.target.files ?? []))
                    }
                    className="w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-sky-50 file:text-sky-700 dark:file:bg-sky-900/30 dark:file:text-sky-300"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 bg-sky-600 text-white rounded-2xl font-bold hover:bg-sky-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : editing ? (
                    'Save Changes'
                  ) : (
                    'Add Insurance'
                  )}
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
              className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
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
              <div className="p-4 overflow-auto max-h-[calc(90vh-4rem)] flex items-center justify-center">
                {previewMime?.startsWith('image/') ? (
                  <img
                    src={previewUrl}
                    alt={previewTitle}
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    title={previewTitle}
                    className="w-full h-[70vh] rounded-lg border-0"
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
