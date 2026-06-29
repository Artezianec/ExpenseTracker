export type GroupType = 'personal' | 'household' | 'trip' | 'other';
export type SplitType = 'equal' | 'percentage' | 'exact';
export type MemberRole = 'admin' | 'member';
export type BudgetType = 'weekly' | 'monthly' | 'total';

/** ISO 8601 timestamp string stored in MySQL. */
export type DbTimestamp = string;

export interface AppUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: DbTimestamp;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  month: number;
  year: number;
  createdBy: string;
  createdAt: DbTimestamp;
  type: GroupType;
  memberIds: string[];
  maxBudget?: number;
  budgetType?: BudgetType;
  installments?: GroupInstallment[];
  creditPayments?: GroupCreditPayment[];
  insurancePayments?: GroupInsurancePayment[];
  shoppingTrips?: GroupShoppingTrip[];
}

export interface GroupCreditPayment {
  id: string;
  creditId: string;
  creditName: string;
  lender?: string;
  amount: number;
  paymentNumber: number;
  paymentDay: number;
  month: number;
  year: number;
}

export interface GroupInsurancePayment {
  id: string;
  insuranceId: string;
  insuranceName: string;
  company: string;
  subjectLabel?: string;
  amount: number;
  paymentNumber: number;
  paymentDay: number;
  month: number;
  year: number;
}

export interface GroupInstallment {
  id: string;
  purchaseId: string;
  purchaseName: string;
  store?: string;
  amount: number;
  installmentNumber: number;
  month: number;
  year: number;
}

export interface GroupShoppingTrip {
  id: string;
  storeName?: string;
  totalAmount: number;
  tripDate: DbTimestamp;
  source: ShoppingTripSource;
  itemCount: number;
}

export type ShoppingTripSource = 'scan' | 'receipt' | 'manual';

export interface ProductPrice {
  chainId: string;
  chainName: string;
  storeId?: string;
  storeName?: string;
  price: number;
  priceUpdatedAt?: DbTimestamp;
  syncedAt: DbTimestamp;
}

export interface Product {
  barcode: string;
  nameHe: string;
  manufacturer?: string;
  unitQty?: string;
  unitMeasure?: string;
  prices: ProductPrice[];
  minPrice?: number;
  updatedAt: DbTimestamp;
}

export interface FavoriteProduct {
  barcode: string;
  nickname?: string;
  createdAt: DbTimestamp;
  product: Product;
  priceHistory: {
    price: number;
    recordedAt: DbTimestamp;
    chainId?: string;
    chainName?: string;
  }[];
}

export interface ShoppingTripItem {
  id?: string;
  barcode?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isWeighed?: boolean;
  weightKg?: number;
  sortOrder?: number;
}

export interface ShoppingTrip {
  id: string;
  userId: string;
  groupId: string;
  storeName?: string;
  chainId?: string;
  totalAmount: number;
  tripDate: DbTimestamp;
  source: ShoppingTripSource;
  createdAt: DbTimestamp;
  items: ShoppingTripItem[];
  receipts: PurchaseReceipt[];
}

export interface ReceiptParseDraft {
  storeName?: string;
  tripDate: string;
  totalAmount: number;
  items: ShoppingTripItem[];
  source: ShoppingTripSource;
}

export type InterestRatePeriod = 'monthly' | 'annual';

export interface PurchaseReceipt {
  id: string;
  originalName?: string;
  mimeType?: string;
  createdAt: DbTimestamp;
}

export interface PurchaseInstallment {
  id: string;
  groupId: string;
  installmentNumber: number;
  amount: number;
  month: number;
  year: number;
}

export interface Purchase {
  id: string;
  name: string;
  amount: number;
  store?: string;
  purchaseDate: DbTimestamp;
  warrantyExpiresAt?: DbTimestamp;
  installmentCount: number;
  interestRate?: number;
  interestRatePeriod?: InterestRatePeriod;
  receipts: PurchaseReceipt[];
  createdAt: DbTimestamp;
  installments: PurchaseInstallment[];
  totalScheduled?: number;
  totalInterest?: number;
}

export interface CreditPayment {
  id: string;
  groupId: string;
  paymentNumber: number;
  amount: number;
  month: number;
  year: number;
}

export interface Credit {
  id: string;
  name: string;
  lender?: string;
  principal: number;
  interestRate: number;
  interestRatePeriod: InterestRatePeriod;
  termMonths: number;
  paymentDay: number;
  startDate: DbTimestamp;
  createdAt: DbTimestamp;
  payments: CreditPayment[];
  totalScheduled?: number;
  totalInterest?: number;
  monthlyPayment?: number;
}

export type InsuranceSubjectType = 'person' | 'purchase' | 'other';

export interface InsuranceContract {
  id: string;
  originalName?: string;
  mimeType?: string;
  createdAt: DbTimestamp;
}

export interface InsurancePayment {
  id: string;
  groupId: string;
  paymentNumber: number;
  amount: number;
  month: number;
  year: number;
}

export interface Insurance {
  id: string;
  name: string;
  company: string;
  monthlyAmount: number;
  subjectType: InsuranceSubjectType;
  subjectUserId?: string;
  subjectPurchaseId?: string;
  subjectLabel?: string;
  subjectDisplayName: string;
  paymentDay: number;
  startDate: DbTimestamp;
  endDate?: DbTimestamp;
  createdAt: DbTimestamp;
  contracts: InsuranceContract[];
  payments: InsurancePayment[];
  scheduleMonths?: number;
}

export interface HouseholdMember {
  userId: string;
  displayName: string | null;
  email: string;
  photoURL: string | null;
  role: 'admin' | 'member';
  joinedAt: DbTimestamp;
}

export interface Participant {
  id: string;
  groupId: string;
  name: string;
  userId?: string;
  joinedAt: DbTimestamp;
  totalIncome: number;
}

export interface Income {
  id: string;
  groupId: string;
  participantId: string;
  participantName: string;
  amount: number;
  source: string;
  date: DbTimestamp;
  createdAt: DbTimestamp;
}

export interface GroupMember {
  uid: string;
  groupId: string;
  role: MemberRole;
  joinedAt: DbTimestamp;
  displayName?: string;
  email?: string;
}

export interface Category {
  id: string;
  name: string;
  priority: number;
  createdAt: DbTimestamp;
}

export interface Expense {
  id: string;
  groupId: string;
  amount: number;
  description: string;
  category: string;
  paidBy: string;
  date: DbTimestamp;
  createdAt: DbTimestamp;
  splitType: SplitType;
}

/** @deprecated use user categories from API */
export const DEFAULT_CATEGORY_NAMES = [
  'Food',
  'Rent',
  'Utilities',
  'Transport',
  'Entertainment',
  'Shopping',
  'Health',
  'Travel',
  'Other',
];
