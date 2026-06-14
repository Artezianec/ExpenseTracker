export type GroupType = 'personal' | 'household' | 'trip' | 'other';
export type SplitType = 'equal' | 'percentage' | 'exact';
export type MemberRole = 'admin' | 'member';
export type BudgetType = 'weekly' | 'monthly' | 'total';

/** ISO 8601 timestamp string stored in ApexStream Document DB. */
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
  createdBy: string;
  createdAt: DbTimestamp;
  type: GroupType;
  memberIds: string[];
  maxBudget?: number;
  budgetType?: BudgetType;
}

export interface GroupMember {
  uid: string;
  groupId: string;
  role: MemberRole;
  joinedAt: DbTimestamp;
  displayName?: string;
  email?: string;
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

export const CATEGORIES = [
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
