import type { ApexStreamDatabase, AppDocument } from '@apexstream/client';
import type { AppAuthSession } from '@apexstream/client';
import type {
  AppUser,
  Expense,
  Group,
  GroupMember,
  UserProfile,
} from '../types';
import { dateToIso, nowIso } from './dates';
import { sessionToAppUser } from './user';

export const COLLECTIONS = {
  users: 'users',
  groups: 'groups',
  expenses: 'expenses',
  members: 'members',
} as const;

const LIST_LIMIT = 500;

function docData<T>(doc: AppDocument): T {
  return doc.data as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function memberDocId(groupId: string, uid: string): string {
  return `${groupId}__${uid}`;
}

export async function ensureUserProfile(
  db: ApexStreamDatabase,
  session: AppAuthSession,
): Promise<AppUser> {
  const appUser = sessionToAppUser(session);
  const ref = db.collection(COLLECTIONS.users).doc(appUser.uid);

  try {
    const existing = await ref.get();
    const data = docData<UserProfile>(existing);
    await ref.patch({
      displayName: appUser.displayName ?? data.displayName,
      email: appUser.email ?? data.email,
      photoURL: appUser.photoURL ?? data.photoURL,
    });
  } catch {
    const profile: UserProfile = {
      uid: appUser.uid,
      displayName: appUser.displayName,
      email: appUser.email,
      photoURL: appUser.photoURL,
      createdAt: nowIso(),
    };
    await ref.set(asRecord(profile));
  }

  return appUser;
}

export function parseGroup(doc: AppDocument): Group {
  const data = docData<Omit<Group, 'id'>>(doc);
  return { id: doc.document_id, ...data };
}

export function parseExpense(doc: AppDocument): Expense {
  const data = docData<Omit<Expense, 'id'>>(doc);
  return { id: doc.document_id, ...data };
}

export function parseMember(doc: AppDocument): GroupMember {
  const data = docData<GroupMember>(doc);
  return {
    ...data,
    uid: data.uid ?? doc.document_id.split('__').pop() ?? doc.document_id,
  };
}

export async function listUserGroups(
  db: ApexStreamDatabase,
  userId: string,
): Promise<Group[]> {
  const docs = await db.collection(COLLECTIONS.groups).list(LIST_LIMIT);
  return docs
    .map(parseGroup)
    .filter((g) => g.memberIds.includes(userId))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function listGroupExpenses(
  db: ApexStreamDatabase,
  groupId: string,
): Promise<Expense[]> {
  const docs = await db.collection(COLLECTIONS.expenses).list(LIST_LIMIT);
  return docs
    .map(parseExpense)
    .filter((e) => e.groupId === groupId)
    .sort((a, b) => toMillis(b.date) - toMillis(a.date));
}

export async function listGroupMembers(
  db: ApexStreamDatabase,
  groupId: string,
): Promise<GroupMember[]> {
  const docs = await db.collection(COLLECTIONS.members).list(LIST_LIMIT);
  return docs
    .map(parseMember)
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => toMillis(a.joinedAt) - toMillis(b.joinedAt));
}

export function subscribeToUserGroups(
  db: ApexStreamDatabase,
  userId: string,
  onUpdate: (groups: Group[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const refresh = () => {
    void listUserGroups(db, userId)
      .then(onUpdate)
      .catch((error) => onError?.(error));
  };

  refresh();
  const unsubGroups = db.collection(COLLECTIONS.groups).onChange(() => refresh());
  const unsubMembers = db.collection(COLLECTIONS.members).onChange(() => refresh());

  return () => {
    unsubGroups();
    unsubMembers();
  };
}

export function subscribeToGroup(
  db: ApexStreamDatabase,
  groupId: string,
  onUpdate: (group: Group | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  const refresh = async () => {
    try {
      const doc = await db.collection(COLLECTIONS.groups).doc(groupId).get();
      onUpdate(parseGroup(doc));
    } catch {
      onUpdate(null);
    }
  };

  refresh().catch((error) => onError?.(error));
  return db.collection(COLLECTIONS.groups).onChange((ev) => {
    if (ev.id === groupId) {
      void refresh();
    }
  });
}

export function subscribeToGroupExpenses(
  db: ApexStreamDatabase,
  groupId: string,
  onUpdate: (expenses: Expense[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const refresh = () => {
    void listGroupExpenses(db, groupId)
      .then(onUpdate)
      .catch((error) => onError?.(error));
  };

  refresh();
  return db.collection(COLLECTIONS.expenses).onChange(() => refresh());
}

export function subscribeToGroupMembers(
  db: ApexStreamDatabase,
  groupId: string,
  onUpdate: (members: GroupMember[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const refresh = () => {
    void listGroupMembers(db, groupId)
      .then(onUpdate)
      .catch((error) => onError?.(error));
  };

  refresh();
  return db.collection(COLLECTIONS.members).onChange(() => refresh());
}

export async function createGroup(
  db: ApexStreamDatabase,
  user: AppUser,
  input: {
    name: string;
    description?: string;
    type: Group['type'];
    maxBudget?: number;
    budgetType?: Group['budgetType'];
  },
): Promise<string> {
  const groupId = crypto.randomUUID();
  const createdAt = nowIso();

  const group: Omit<Group, 'id'> = {
    name: input.name,
    description: input.description,
    type: input.type,
    createdBy: user.uid,
    createdAt,
    memberIds: [user.uid],
    ...(input.maxBudget != null
      ? { maxBudget: input.maxBudget, budgetType: input.budgetType ?? 'monthly' }
      : {}),
  };

  await db.collection(COLLECTIONS.groups).doc(groupId).set(asRecord(group));
  await db
    .collection(COLLECTIONS.members)
    .doc(memberDocId(groupId, user.uid))
    .set(
      asRecord({
        groupId,
        uid: user.uid,
        role: 'admin',
        joinedAt: createdAt,
        displayName: user.displayName,
        email: user.email,
      }),
    );

  return groupId;
}

export async function updateGroup(
  db: ApexStreamDatabase,
  groupId: string,
  data: Partial<Pick<Group, 'name' | 'description' | 'maxBudget' | 'budgetType'>>,
): Promise<void> {
  await db.collection(COLLECTIONS.groups).doc(groupId).patch(data);
}

export async function deleteGroup(
  db: ApexStreamDatabase,
  groupId: string,
): Promise<void> {
  const [expenses, members] = await Promise.all([
    listGroupExpenses(db, groupId),
    listGroupMembers(db, groupId),
  ]);

  await Promise.all([
    ...expenses.map((e) =>
      db.collection(COLLECTIONS.expenses).doc(e.id).delete(),
    ),
    ...members.map((m) =>
      db.collection(COLLECTIONS.members).doc(memberDocId(groupId, m.uid)).delete(),
    ),
    db.collection(COLLECTIONS.groups).doc(groupId).delete(),
  ]);
}

export async function createExpense(
  db: ApexStreamDatabase,
  groupId: string,
  user: AppUser,
  input: {
    amount: number;
    description: string;
    category: string;
    date: Date;
  },
): Promise<string> {
  const expenseId = crypto.randomUUID();
  const createdAt = nowIso();

  const expense: Omit<Expense, 'id'> = {
    groupId,
    amount: input.amount,
    description: input.description.trim(),
    category: input.category,
    paidBy: user.uid,
    date: dateToIso(input.date),
    createdAt,
    splitType: 'equal',
  };

  await db.collection(COLLECTIONS.expenses).doc(expenseId).set(asRecord(expense));
  return expenseId;
}

export async function updateExpense(
  db: ApexStreamDatabase,
  expenseId: string,
  data: Partial<Pick<Expense, 'amount' | 'description' | 'category' | 'date'>>,
): Promise<void> {
  await db.collection(COLLECTIONS.expenses).doc(expenseId).patch(data);
}

export async function deleteExpense(
  db: ApexStreamDatabase,
  expenseId: string,
): Promise<void> {
  await db.collection(COLLECTIONS.expenses).doc(expenseId).delete();
}

export async function resetDemoUserData(
  db: ApexStreamDatabase,
  userId: string,
): Promise<void> {
  const groups = await listUserGroups(db, userId);
  const owned = groups.filter((g) => g.createdBy === userId);
  await Promise.all(owned.map((g) => deleteGroup(db, g.id)));
  await db.collection(COLLECTIONS.users).doc(userId).patch({ createdAt: nowIso() });
}

function toMillis(value: string): number {
  return new Date(value).getTime();
}
