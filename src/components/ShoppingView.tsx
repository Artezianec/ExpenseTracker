import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Barcode,
  Camera,
  CameraOff,
  Heart,
  Loader2,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  ChevronUp,
  Upload,
  X,
} from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { Group, Product, ShoppingTripItem } from '../types';
import { formatCurrency, formatDate, formatMonthYearFromParts } from '../utils/format';
import { toDate } from '../lib/dates';
import {
  addFavorite,
  fetchPriceSyncStatus,
  lookupProduct,
  removeFavorite,
  searchProducts,
  subscribeToFavorites,
} from '../lib/products';
import { chainLabel, cheapestPrice } from '../lib/productPricing';
import { ProductChainPrices } from './ProductChainPrices';
import FavoritesPriceCompare from './FavoritesPriceCompare';
import {
  createShoppingTrip,
  parseReceipt,
  subscribeToShoppingTrips,
} from '../lib/shopping-trips';
import { ApiError, apiFetch } from '../lib/api';
import type { FavoriteProduct } from '../types';

function canUseLiveCamera(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

type Tab = 'scan' | 'receipt' | 'catalog' | 'favorites';

type ReceiptOcrInfo = {
  provider: string;
  model: string;
  baseUrl?: string;
  configured: boolean;
  available?: boolean;
};

interface CartLine extends ShoppingTripItem {
  key: string;
}

interface ShoppingViewProps {
  groups: Group[];
  defaultGroupId?: string | null;
  onSelectMonth?: (groupId: string) => void;
}

function cartTotal(items: CartLine[]) {
  return Math.round(items.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
}

export default function ShoppingView({
  groups,
  defaultGroupId,
  onSelectMonth,
}: ShoppingViewProps) {
  const [tab, setTab] = useState<Tab>('scan');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState('');
  const [storeName, setStoreName] = useState('חצי חינם');
  const [tripDate, setTripDate] = useState(
    new Date().toISOString().split('T')[0],
  );
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [recentTrips, setRecentTrips] = useState<
    import('../types').ShoppingTrip[]
  >([]);

  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [syncStatus, setSyncStatus] = useState<{
    enabled: boolean;
    running: boolean;
    lastSuccessAt: string | null;
    productCount: number;
  } | null>(null);
  const [lastLookupStore, setLastLookupStore] = useState<string | null>(null);

  const [receiptPreview, setReceiptPreview] = useState<{
    storeName?: string;
    tripDate: string;
    totalAmount: number;
    items: CartLine[];
  } | null>(null);
  const [receiptParsing, setReceiptParsing] = useState(false);
  const [receiptOcr, setReceiptOcr] = useState<ReceiptOcrInfo | null>(null);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [barcodePhotoLoading, setBarcodePhotoLoading] = useState(false);

  const liveCameraOk = canUseLiveCamera();

  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const scanControlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScanRef = useRef('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (defaultGroupId) setGroupId(defaultGroupId);
  }, [defaultGroupId]);

  useEffect(() => {
    if (!groupId && groups.length) {
      const now = new Date();
      const match = groups.find(
        (g) => g.month === now.getMonth() + 1 && g.year === now.getFullYear(),
      );
      setGroupId(match?.id ?? groups[0].id);
    }
  }, [groups, groupId]);

  useEffect(() => {
    return subscribeToShoppingTrips(setRecentTrips, () => {}, undefined);
  }, []);

  useEffect(() => {
    return subscribeToFavorites(setFavorites, () => {});
  }, []);

  useEffect(() => {
    void fetchPriceSyncStatus()
      .then(setSyncStatus)
      .catch(() => setSyncStatus(null));
    const id = window.setInterval(() => {
      void fetchPriceSyncStatus()
        .then(setSyncStatus)
        .catch(() => {});
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    apiFetch<{ receiptOcr?: ReceiptOcrInfo }>('/health')
      .then((d) => setReceiptOcr(d.receiptOcr ?? null))
      .catch(() => setReceiptOcr(null));
  }, []);

  useEffect(() => {
    if (tab !== 'catalog') return;
    const t = window.setTimeout(async () => {
      if (!catalogQuery.trim()) {
        setCatalogResults([]);
        return;
      }
      setCatalogLoading(true);
      try {
        setCatalogResults(await searchProducts(catalogQuery));
      } catch {
        setCatalogResults([]);
      } finally {
        setCatalogLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [catalogQuery, tab]);

  const addToCart = useCallback((item: Omit<CartLine, 'key'>) => {
    setCart((prev) => {
      const existing = item.barcode
        ? prev.find((l) => l.barcode === item.barcode)
        : null;
      if (existing && !item.isWeighed) {
        return prev.map((l) =>
          l.key === existing.key
            ? {
                ...l,
                quantity: l.quantity + 1,
                lineTotal:
                  Math.round((l.quantity + 1) * l.unitPrice * 100) / 100,
              }
            : l,
        );
      }
      return [
        ...prev,
        {
          ...item,
          key: `${item.barcode ?? 'manual'}-${Date.now()}-${Math.random()}`,
        },
      ];
    });
  }, []);

  const handleLookupBarcode = useCallback(
    async (code: string) => {
      const barcode = code.trim();
      if (!barcode || barcode.length < 4) return;
      if (lastScanRef.current === barcode) return;
      lastScanRef.current = barcode;
      window.setTimeout(() => {
        lastScanRef.current = '';
      }, 2000);

      setLookupLoading(true);
      setError('');
      try {
        const product = await lookupProduct(barcode);
        const best = cheapestPrice(product.prices);
        const price = product.minPrice ?? product.prices[0]?.price ?? 0;
        setLastLookupStore(best ? chainLabel(best) : null);
        addToCart({
          barcode: product.barcode,
          name: product.nameHe,
          quantity: 1,
          unitPrice: price,
          lineTotal: price,
        });
        setBarcodeInput('');
      } catch {
        addToCart({
          barcode,
          name: barcode,
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0,
        });
        setError('Not in catalog — added manually, set the price');
      } finally {
        setLookupLoading(false);
      }
    },
    [addToCart],
  );

  const handleBarcodePhoto = async (file: File) => {
    setBarcodePhotoLoading(true);
    setError('');
    const reader = new BrowserMultiFormatReader();
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      await handleLookupBarcode(result.getText());
    } catch {
      setError(
        'Barcode not found on photo. Move closer or enter the code manually.',
      );
    } finally {
      URL.revokeObjectURL(url);
      setBarcodePhotoLoading(false);
    }
  };

  useEffect(() => {
    if (!scanning || tab !== 'scan' || !liveCameraOk) return;

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices!.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled || !videoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        await reader.decodeFromVideoElement(
          videoRef.current,
          (result, err) => {
            if (result) {
              void handleLookupBarcode(result.getText());
            }
            if (err && err.name !== 'NotFoundException') {
              /* continuous scan */
            }
          },
        ).then((controls) => {
          scanControlsRef.current = controls;
        });
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Camera access denied. Use photo scan or manual entry.',
        );
        setScanning(false);
      }
    })();

    return () => {
      cancelled = true;
      scanControlsRef.current?.stop();
      scanControlsRef.current = null;
      readerRef.current = null;
      const video = videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [scanning, tab, handleLookupBarcode, liveCameraOk]);

  const updateCartLine = (key: string, patch: Partial<CartLine>) => {
    const updater = (prev: CartLine[]) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.unitPrice != null || patch.quantity != null) {
          next.lineTotal =
            Math.round(next.quantity * next.unitPrice * 100) / 100;
        }
        return next;
      });

    if (receiptPreview) {
      setReceiptPreview((p) =>
        p ? { ...p, items: updater(p.items) } : p,
      );
    } else {
      setCart(updater);
    }
  };

  const removeLine = (key: string) => {
    if (receiptPreview) {
      setReceiptPreview((p) =>
        p ? { ...p, items: p.items.filter((l) => l.key !== key) } : p,
      );
    } else {
      setCart((prev) => prev.filter((l) => l.key !== key));
    }
  };

  const saveTrip = async (items: CartLine[], extra?: { source?: 'scan' | 'receipt' }) => {
    if (!items.length) {
      setError('Add at least one item');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const trip = await createShoppingTrip({
        groupId: groupId || undefined,
        storeName: storeName.trim() || undefined,
        tripDate: new Date(tripDate).toISOString(),
        source: extra?.source ?? 'scan',
        totalAmount: cartTotal(items),
        items: items.map(({ key: _k, ...item }) => item),
      });
      setCart([]);
      setReceiptPreview(null);
      onSelectMonth?.(trip.groupId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiptFile = async (file: File) => {
    setReceiptParsing(true);
    setError('');
    try {
      const draft = await parseReceipt(file);
      setReceiptPreview({
        storeName: draft.storeName,
        tripDate: draft.tripDate.split('T')[0],
        totalAmount: draft.totalAmount,
        items: draft.items.map((item, i) => ({
          ...item,
          key: `r-${i}-${Date.now()}`,
        })),
      });
      if (draft.storeName) setStoreName(draft.storeName);
      if (draft.tripDate) setTripDate(draft.tripDate.split('T')[0]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        const hint =
          receiptOcr?.provider === 'ollama'
            ? `Receipt OCR uses Ollama (${receiptOcr.baseUrl}, model ${receiptOcr.model}). Start Ollama and run: ollama pull ${receiptOcr.model}`
            : 'Receipt OCR unavailable. Set RECEIPT_OCR_PROVIDER=ollama or GEMINI_API_KEY in .env and restart dev:server';
        setError(hint);
      } else {
        setError(e instanceof Error ? e.message : 'Could not parse receipt');
      }
    } finally {
      setReceiptParsing(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'scan', label: 'Scan', icon: <Barcode className="w-4 h-4 shrink-0" /> },
    { id: 'receipt', label: 'Receipt', icon: <Receipt className="w-4 h-4 shrink-0" /> },
    { id: 'catalog', label: 'Catalog', icon: <Search className="w-4 h-4 shrink-0" /> },
    { id: 'favorites', label: 'Favorites', icon: <Heart className="w-4 h-4 shrink-0" /> },
  ];

  const displayItems = receiptPreview?.items ?? cart;
  const displayTotal = receiptPreview?.totalAmount ?? cartTotal(cart);
  const showCartPanel =
    displayItems.length > 0 || tab === 'scan' || tab === 'receipt';
  const cartPadding = showCartPanel && displayItems.length > 0 ? 'pb-36 lg:pb-6' : 'pb-6';

  return (
    <div className={`space-y-4 sm:space-y-6 ${cartPadding}`}>
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white font-display tracking-tight">
          Shop
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-xs sm:text-sm">
          Scan barcodes, import receipts, or browse the catalog — save to a budget month
        </p>
      </div>

      <div className="grid grid-cols-2 sm:flex gap-1 p-1 bg-zinc-100 dark:bg-white/5 rounded-xl">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-lg text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-white'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium">
          {error}
        </div>
      )}

      {tab === 'scan' && (
        <div className="space-y-4">
          {!liveCameraOk && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-xl p-3">
              Live camera on phone requires <strong>HTTPS</strong> (or localhost).
              Use <strong>Photo barcode</strong> or manual entry below. For Wi‑Fi
              camera: set <code>VITE_DEV_HTTPS=true</code> and open{' '}
              <code>https://YOUR-PC-IP:3000</code>.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            {liveCameraOk && (
              <button
                type="button"
                onClick={() => setScanning((s) => !s)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm ${
                  scanning
                    ? 'bg-red-500/10 text-red-600'
                    : 'bg-indigo-600 text-white'
                }`}
              >
                {scanning ? (
                  <>
                    <CameraOff className="w-5 h-5" /> Stop camera
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5" /> Camera
                  </>
                )}
              </button>
            )}
            <label
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer ${
                liveCameraOk
                  ? 'bg-zinc-100 dark:bg-white/10 text-zinc-800 dark:text-white'
                  : 'bg-indigo-600 text-white'
              } ${barcodePhotoLoading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {barcodePhotoLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Camera className="w-5 h-5" />
              )}
              Photo barcode
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleBarcodePhoto(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {scanning && (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] max-h-64">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
              <div className="absolute inset-0 border-2 border-white/30 m-8 rounded-lg pointer-events-none" />
            </div>
          )}

          {lastLookupStore && tab === 'scan' && (
            <p className="text-xs text-emerald-600 font-medium">
              Last item: best price at {lastLookupStore}
            </p>
          )}

          <div className="flex gap-2">
            <input
              ref={barcodeInputRef}
              type="text"
              inputMode="numeric"
              placeholder="Barcode or USB scanner"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleLookupBarcode(barcodeInput);
                }
              }}
              className="flex-1 px-4 py-3 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 font-mono text-sm"
            />
            <button
              type="button"
              disabled={lookupLoading}
              onClick={() => void handleLookupBarcode(barcodeInput)}
              className="px-4 py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold text-sm disabled:opacity-50"
            >
              {lookupLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Plus className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      )}

      {tab === 'receipt' && (
        <div className="space-y-4">
          {receiptOcr && !receiptOcr.available && (
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-xl p-3 leading-relaxed">
              Receipt OCR: <strong>{receiptOcr.provider}</strong> · model{' '}
              <code>{receiptOcr.model}</code>
              {receiptOcr.provider === 'ollama' && receiptOcr.baseUrl && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    href={receiptOcr.baseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {receiptOcr.baseUrl}
                  </a>
                </>
              )}
              {receiptOcr.provider === 'gemini' && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Google AI Studio
                  </a>
                </>
              )}
              .{' '}
              {receiptOcr.provider === 'ollama'
                ? `Start Ollama and run: ollama pull ${receiptOcr.model}`
                : 'Set GEMINI_API_KEY in .env and restart dev:server'}
            </p>
          )}
          {receiptOcr?.available && (
            <p className="text-xs text-zinc-500">
              OCR: {receiptOcr.provider} / {receiptOcr.model}
              {receiptOcr.baseUrl && receiptOcr.provider === 'ollama'
                ? ` · ${receiptOcr.baseUrl}`
                : ''}
            </p>
          )}
          <label className="flex flex-col items-center justify-center gap-3 p-6 sm:p-8 border-2 border-dashed border-zinc-300 dark:border-white/20 rounded-2xl cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
            <Upload className="w-10 h-10 text-zinc-400" />
            <span className="font-bold text-zinc-700 dark:text-zinc-300 text-sm sm:text-base">
              Upload receipt photo
            </span>
            <span className="text-xs text-zinc-500 text-center px-4">
              JPEG, PNG — {receiptOcr?.provider ?? 'ollama'} OCR
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleReceiptFile(f);
              }}
            />
          </label>
          {receiptParsing && (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Parsing receipt…
            </div>
          )}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="space-y-4">
          {syncStatus && (
            <p className="text-xs text-zinc-500 bg-zinc-50 dark:bg-white/5 rounded-xl px-3 py-2">
              Catalog: {syncStatus.productCount} products
              {syncStatus.lastSuccessAt && (
                <>
                  {' '}
                  · updated {formatDate(toDate(syncStatus.lastSuccessAt))}
                </>
              )}
              {syncStatus.running && ' · syncing…'}
              {syncStatus.enabled && !syncStatus.running && (
                <span className="text-emerald-600"> · auto daily</span>
              )}
            </p>
          )}
          <input
            type="search"
            placeholder="Search by name or barcode"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10"
          />
          {catalogLoading && (
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400 mx-auto" />
          )}
          <div className="space-y-2">
            {catalogResults.map((p) => (
              <div
                key={p.barcode}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 sm:p-4 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10"
              >
                <div className="flex-1 min-w-0 w-full">
                  <p className="font-bold text-zinc-900 dark:text-white truncate">
                    {p.nameHe}
                  </p>
                  <p className="text-xs font-mono text-zinc-500">{p.barcode}</p>
                  <ProductChainPrices product={p} compact />
                </div>
                <div className="flex gap-2 self-end sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      addToCart({
                        barcode: p.barcode,
                        name: p.nameHe,
                        quantity: 1,
                        unitPrice: p.minPrice ?? 0,
                        lineTotal: p.minPrice ?? 0,
                      })
                    }
                    className="p-2.5 rounded-lg bg-indigo-600 text-white"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void addFavorite(p.barcode)}
                    className="p-2.5 rounded-lg text-zinc-400 hover:text-red-500"
                  >
                    <Heart className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'favorites' && (
        <div className="space-y-4">
          <FavoritesPriceCompare favorites={favorites} />
          {favorites.length === 0 && (
            <p className="text-zinc-500 text-sm text-center py-8">
              Add items from the catalog to favorites
            </p>
          )}
          {favorites.map((f) => (
            <div
              key={f.barcode}
              className="p-4 rounded-2xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 space-y-3"
            >
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-bold text-zinc-900 dark:text-white">
                    {f.nickname ?? f.product.nameHe}
                  </p>
                  <p className="text-xs font-mono text-zinc-500">{f.barcode}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeFavorite(f.barcode)}
                  className="text-zinc-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {f.product.minPrice != null && (
                <p className="text-lg font-black text-emerald-600">
                  from {formatCurrency(f.product.minPrice)}
                  {cheapestPrice(f.product.prices) && (
                    <span className="text-sm font-bold text-zinc-500 ml-2">
                      · {chainLabel(cheapestPrice(f.product.prices)!)}
                    </span>
                  )}
                </p>
              )}
              {f.product.prices.length > 0 && (
                <ProductChainPrices product={f.product} />
              )}
              {f.priceHistory.length > 1 && (
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={[...f.priceHistory].reverse().map((h) => ({
                        date: formatDate(toDate(h.recordedAt)),
                        price: h.price,
                        chain: h.chainName ?? '',
                      }))}
                    >
                      <XAxis dataKey="date" hide />
                      <YAxis domain={['auto', 'auto']} hide />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(_, payload) => {
                          const p = payload?.[0]?.payload as
                            | { chain?: string }
                            | undefined;
                          return p?.chain ? p.chain : '';
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#10b981"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  addToCart({
                    barcode: f.barcode,
                    name: f.product.nameHe,
                    quantity: 1,
                    unitPrice: f.product.minPrice ?? 0,
                    lineTotal: f.product.minPrice ?? 0,
                  })
                }
                className="w-full py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-bold"
              >
                Add to cart
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Cart / checkout panel */}
      {showCartPanel && (
        <div className="fixed bottom-0 left-0 right-0 lg:relative lg:bottom-auto z-40 bg-white/95 dark:bg-zinc-950/95 lg:bg-transparent backdrop-blur-lg border-t lg:border-0 border-zinc-200 dark:border-white/10 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-3xl mx-auto px-3 sm:px-4 pt-2 lg:px-0 lg:pt-0">
            <button
              type="button"
              onClick={() => setCartExpanded((v) => !v)}
              className="lg:hidden w-full flex items-center gap-2 py-2 text-sm font-bold text-zinc-700 dark:text-zinc-300"
            >
              <ShoppingCart className="w-4 h-4 shrink-0" />
              Cart ({displayItems.length})
              <span className="ml-auto text-base text-zinc-900 dark:text-white">
                {formatCurrency(displayTotal)}
              </span>
              <ChevronUp
                className={`w-4 h-4 shrink-0 transition-transform ${cartExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            <div
              className={`space-y-3 ${cartExpanded ? 'block' : 'hidden'} lg:block pb-3 lg:pb-0`}
            >
            <div className="hidden lg:flex items-center gap-2 text-sm font-bold text-zinc-700 dark:text-zinc-300">
              <ShoppingCart className="w-4 h-4" />
              Cart ({displayItems.length})
              <span className="ml-auto text-lg text-zinc-900 dark:text-white">
                {formatCurrency(displayTotal)}
              </span>
            </div>

            <div className="max-h-32 sm:max-h-40 overflow-y-auto space-y-2">
              {displayItems.map((line) => (
                <div
                  key={line.key}
                  className="flex items-center gap-2 text-sm bg-zinc-50 dark:bg-white/5 rounded-lg p-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{line.name}</p>
                    <p className="text-xs text-zinc-500 font-mono">
                      {line.barcode ?? '—'}
                    </p>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) =>
                      updateCartLine(line.key, {
                        unitPrice: Number(e.target.value),
                      })
                    }
                    className="w-16 px-1 py-0.5 rounded text-right font-mono text-xs bg-white dark:bg-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    className="text-zinc-400 hover:text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Store"
                value={receiptPreview?.storeName ?? storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10"
              />
              <input
                type="date"
                value={receiptPreview?.tripDate ?? tripDate}
                onChange={(e) => setTripDate(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10"
              />
            </div>

            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {formatMonthYearFromParts(g.month, g.year)} — {g.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={submitting || displayItems.length === 0}
              onClick={() =>
                void saveTrip(displayItems, {
                  source: receiptPreview ? 'receipt' : 'scan',
                })
              }
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Star className="w-4 h-4" /> Save to month
                </>
              )}
            </button>
            </div>
          </div>
        </div>
      )}

      {recentTrips.length > 0 && tab === 'scan' && (
        <div className="space-y-2 pt-4 border-t border-zinc-200 dark:border-white/10">
          <h3 className="text-sm font-bold text-zinc-500">Recent trips</h3>
          {recentTrips.slice(0, 5).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectMonth?.(t.groupId)}
              className="w-full flex justify-between p-3 rounded-xl bg-zinc-50 dark:bg-white/5 text-left text-sm"
            >
              <span>
                {t.storeName ?? 'Store'} · {formatDate(toDate(t.tripDate))}
              </span>
              <span className="font-bold">{formatCurrency(t.totalAmount)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
