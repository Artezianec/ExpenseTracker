import { apiFetch } from './api';

export interface SpendingInsightsExpense {
  amount: number;
  description: string;
  category: string;
  date: string;
}

export interface SpendingInsightsScheduled {
  type: string;
  name: string;
  amount: number;
}

export interface SpendingInsightsShoppingTrip {
  storeName?: string;
  tripDate: string;
  totalAmount: number;
  itemCount?: number;
}

export interface SpendingInsightsRequest {
  groupName: string;
  groupType: string;
  budgetType: string;
  month?: number;
  year?: number;
  periodLabel?: string;
  maxBudget?: number | null;
  totalSpent: number;
  scheduledSpend: number;
  totalIncome?: number;
  userSpendSharePct?: number;
  memberCount?: number;
  expenses: SpendingInsightsExpense[];
  scheduled: SpendingInsightsScheduled[];
  shoppingTrips?: SpendingInsightsShoppingTrip[];
}

export async function fetchSpendingInsights(
  payload: SpendingInsightsRequest,
): Promise<{ text: string }> {
  return apiFetch('/ai/spending-insights', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAiInsightsStatus(): Promise<{
  provider: string;
  model: string;
  baseUrl?: string;
  configured: boolean;
  available?: boolean;
}> {
  return apiFetch('/ai/insights-status');
}
