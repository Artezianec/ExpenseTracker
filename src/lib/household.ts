import { apiFetch } from './api';
import { POLL_INTERVAL_MS } from './budgetDb';
import type { HouseholdMember } from '../types';

export async function listHouseholdMembers(): Promise<HouseholdMember[]> {
  return apiFetch<HouseholdMember[]>('/household/members');
}

export async function inviteHouseholdMember(
  email: string,
): Promise<HouseholdMember> {
  return apiFetch<HouseholdMember>('/household/members', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function removeHouseholdMember(userId: string): Promise<void> {
  await apiFetch(`/household/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
}

export function subscribeToHouseholdMembers(
  onUpdate: (members: HouseholdMember[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  let lastSnapshot: string | null = null;
  const tick = () => {
    void listHouseholdMembers()
      .then((members) => {
        const snapshot = JSON.stringify(members);
        if (snapshot === lastSnapshot) return;
        lastSnapshot = snapshot;
        onUpdate(members);
      })
      .catch((error) => onError?.(error));
  };
  tick();
  const id = window.setInterval(tick, POLL_INTERVAL_MS);
  return () => window.clearInterval(id);
}
