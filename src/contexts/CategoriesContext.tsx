import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Category } from '../types';
import {
  listCategories,
  createCategory as apiCreateCategory,
  updateCategory as apiUpdateCategory,
  deleteCategory as apiDeleteCategory,
  categoryNames,
  sortCategories,
} from '../lib/categories';
import { useAuth } from './AuthContext';

interface CategoriesContextValue {
  categories: Category[];
  categoryNames: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  createCategory: (name: string, priority: number) => Promise<void>;
  updateCategory: (
    id: string,
    data: Partial<Pick<Category, 'name' | 'priority'>>,
  ) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
}

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

export function CategoriesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setCategories([]);
      return;
    }
    setLoading(true);
    try {
      const list = await listCategories();
      setCategories(sortCategories(list));
    } catch (error) {
      console.error('Failed to load categories:', error);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createCategory = useCallback(
    async (name: string, priority: number) => {
      const created = await apiCreateCategory(name, priority);
      setCategories((prev) => sortCategories([...prev, created]));
    },
    [],
  );

  const updateCategory = useCallback(
    async (id: string, data: Partial<Pick<Category, 'name' | 'priority'>>) => {
      const updated = await apiUpdateCategory(id, data);
      setCategories((prev) =>
        sortCategories(prev.map((c) => (c.id === id ? updated : c))),
      );
    },
    [],
  );

  const deleteCategory = useCallback(async (id: string) => {
    await apiDeleteCategory(id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      categories,
      categoryNames: categoryNames(categories),
      loading,
      refresh,
      createCategory,
      updateCategory,
      deleteCategory,
    }),
    [
      categories,
      loading,
      refresh,
      createCategory,
      updateCategory,
      deleteCategory,
    ],
  );

  return (
    <CategoriesContext.Provider value={value}>
      {children}
    </CategoriesContext.Provider>
  );
}

export function useCategories() {
  const ctx = useContext(CategoriesContext);
  if (!ctx) {
    throw new Error('useCategories must be used within CategoriesProvider');
  }
  return ctx;
}
