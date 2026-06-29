import type {
  AppUser,
  Expense,
  Group,
  GroupMember,
  Income,
  Participant,
  UserProfile,
} from '../types';
import { apiFetch } from './api';
import { dateToIso, nowIso } from './dates';

export const POLL_INTERVAL_MS = 15000;

export async function ensureUserProfile(): Promise<AppUser> {
  const { user } = await apiFetch<{ user: AppUser; profile: UserProfile }>(
    '/auth/me',
  );
  return user;
}

export async function listUserGroups(_userId: string): Promise<Group[]> {
  return apiFetch<Group[]>('/groups');
}

export async function listGroupExpenses(groupId: string): Promise<Expense[]> {
  return apiFetch<Expense[]>(`/groups/${encodeURIComponent(groupId)}/expenses`);
}

export async function listGroupMembers(groupId: string): Promise<GroupMember[]> {
  return apiFetch<GroupMember[]>(
    `/groups/${encodeURIComponent(groupId)}/members`,
  );
}

export async function listGroupParticipants(
  groupId: string,
): Promise<Participant[]> {
  return apiFetch<Participant[]>(
    `/groups/${encodeURIComponent(groupId)}/participants`,
  );
}

export async function listGroupIncomes(groupId: string): Promise<Income[]> {
  return apiFetch<Income[]>(
    `/groups/${encodeURIComponent(groupId)}/incomes`,
  );
}

export async function getGroup(groupId: string): Promise<Group | null> {
  try {
    return await apiFetch<Group>(`/groups/${encodeURIComponent(groupId)}`);
  } catch {
    return null;
  }
}

function poll<T>(
  fetcher: () => Promise<T>,
  onUpdate: (data: T) => void,
  onError?: (error: unknown) => void,
): () => void {
  let lastSnapshot: string | null = null;
  const tick = () => {
    void fetcher()
      .then((data) => {
        const snapshot = JSON.stringify(data);
        if (snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;
        onUpdate(data);
      })
      .catch((error) => onError?.(error));
  };
  tick();
  const id = window.setInterval(tick, POLL_INTERVAL_MS);
  return () => window.clearInterval(id);
}

export function subscribeToUserGroups(
  userId: string,
  onUpdate: (groups: Group[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return poll(() => listUserGroups(userId), onUpdate, onError);
}

export function subscribeToGroup(
  groupId: string,
  onUpdate: (group: Group | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  return poll(() => getGroup(groupId), onUpdate, onError);
}

export function subscribeToGroupExpenses(
  groupId: string,
  onUpdate: (expenses: Expense[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return poll(() => listGroupExpenses(groupId), onUpdate, onError);
}

export function subscribeToGroupMembers(
  groupId: string,
  onUpdate: (members: GroupMember[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return poll(() => listGroupMembers(groupId), onUpdate, onError);
}

export function subscribeToGroupParticipants(
  groupId: string,
  onUpdate: (participants: Participant[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return poll(() => listGroupParticipants(groupId), onUpdate, onError);
}

export function subscribeToGroupIncomes(
  groupId: string,
  onUpdate: (incomes: Income[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  return poll(() => listGroupIncomes(groupId), onUpdate, onError);
}

export async function createGroup(
  user: AppUser,
  input: {
    month: number;
    year: number;
    description?: string;
    maxBudget?: number;
  },
): Promise<string> {
  const group = await apiFetch<Group>('/groups', {
    method: 'POST',
    body: JSON.stringify({
      month: input.month,
      year: input.year,
      description: input.description,
      maxBudget: input.maxBudget,
    }),
  });
  return group.id;
}

export async function updateGroup(
  groupId: string,
  data: Partial<
    Pick<Group, 'name' | 'description' | 'maxBudget' | 'budgetType' | 'month' | 'year'>
  >,
): Promise<void> {
  await apiFetch(`/groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(groupId: string): Promise<void> {
  await apiFetch(`/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
}

export async function addParticipant(
  groupId: string,
  input: { name: string; email?: string },
): Promise<Participant> {
  return apiFetch<Participant>(
    `/groups/${encodeURIComponent(groupId)}/participants`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function deleteParticipant(participantId: string): Promise<void> {
  await apiFetch(`/participants/${encodeURIComponent(participantId)}`, {
    method: 'DELETE',
  });
}

export async function createIncome(
  groupId: string,
  input: {
    participantId: string;
    amount: number;
    source: string;
    date: Date;
  },
): Promise<Income> {
  const income = await apiFetch<Income>(
    `/groups/${encodeURIComponent(groupId)}/incomes`,
    {
      method: 'POST',
      body: JSON.stringify({
        participantId: input.participantId,
        amount: input.amount,
        source: input.source.trim(),
        date: dateToIso(input.date),
      }),
    },
  );
  return income;
}

export async function updateIncome(
  incomeId: string,
  data: Partial<
    Pick<Income, 'amount' | 'source' | 'date' | 'participantId'>
  >,
): Promise<void> {
  await apiFetch(`/incomes/${encodeURIComponent(incomeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteIncome(incomeId: string): Promise<void> {
  await apiFetch(`/incomes/${encodeURIComponent(incomeId)}`, {
    method: 'DELETE',
  });
}

export async function createExpense(
  groupId: string,
  user: AppUser,
  input: {
    amount: number;
    description: string;
    category: string;
    date: Date;
  },
): Promise<string> {
  const expense = await apiFetch<Expense>(
    `/groups/${encodeURIComponent(groupId)}/expenses`,
    {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amount,
        description: input.description.trim(),
        category: input.category,
        date: dateToIso(input.date),
      }),
    },
  );
  return expense.id;
}

export async function updateExpense(
  expenseId: string,
  data: Partial<Pick<Expense, 'amount' | 'description' | 'category' | 'date'>>,
): Promise<void> {
  await apiFetch(`/expenses/${encodeURIComponent(expenseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await apiFetch(`/expenses/${encodeURIComponent(expenseId)}`, {
    method: 'DELETE',
  });
}

export async function resetDemoUserData(userId: string): Promise<void> {
  await apiFetch('/users/me/reset-demo', { method: 'POST' });
  void userId;
}

export async function getUserProfile(): Promise<UserProfile> {
  const { profile } = await apiFetch<{ profile: UserProfile }>('/auth/me');
  return profile;
}

export { nowIso };
