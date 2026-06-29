import type { Category } from '../types';
import { apiFetch } from './api';

export async function listCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export async function createCategory(
  name: string,
  priority: number,
): Promise<Category> {
  return apiFetch<Category>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name, priority }),
  });
}

export async function updateCategory(
  id: string,
  data: Partial<Pick<Category, 'name' | 'priority'>>,
): Promise<Category> {
  return apiFetch<Category>(`/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch(`/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name, 'he'),
  );
}

export function categoryNames(categories: Category[]): string[] {
  return sortCategories(categories).map((c) => c.name);
}
