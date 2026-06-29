/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LogOut,
  LayoutDashboard,
  Settings,
  Wallet,
  Menu,
  X,
  Sun,
  Moon,
  Tag,
  Package,
  Landmark,
  Shield,
  Scan,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Group } from './types';
import { useAuth } from './contexts/AuthContext';
import {
  getUserProfile,
  resetDemoUserData,
  subscribeToUserGroups,
} from './lib/budgetDb';

import Dashboard from './components/Dashboard';
import GroupView from './components/GroupView';
import PurchasesView from './components/PurchasesView';
import ShoppingView from './components/ShoppingView';
import CreditsView from './components/CreditsView';
import InsurancesView from './components/InsurancesView';
import CreateGroupModal from './components/CreateGroupModal';
import CategoryManagerModal from './components/CategoryManagerModal';
import MonthsSidebar from './components/MonthsSidebar';
import { appPath, parseAppPath, type MainView } from './lib/appNavigation';

export default function BudgetedApp() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [groups, setGroups] = useState<Group[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [dataDeletedPopup, setDataDeletedPopup] = useState(false);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    }
    return 'dark';
  });

  const { mainView, groupId: selectedGroupId } = useMemo(
    () => parseAppPath(location.pathname),
    [location.pathname],
  );

  const goTo = (view: MainView, groupId: string | null = null) => {
    navigate(appPath(view, groupId));
  };

  const selectGroup = (id: string) => {
    navigate(appPath('dashboard', id));
    setIsSidebarOpen(false);
  };

  const leaveGroup = () => {
    navigate(appPath(mainView));
  };

  useEffect(() => {
    const parsed = parseAppPath(location.pathname);
    const canonical = appPath(parsed.mainView, parsed.groupId);
    const norm = (p: string) => p.replace(/\/+$/, '') || '/';
    if (norm(location.pathname) !== norm(canonical)) {
      navigate(canonical, { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    (window as Window & { openCreateGroupModal?: () => void }).openCreateGroupModal =
      () => setIsCreateModalOpen(true);
    return () => {
      delete (window as Window & { openCreateGroupModal?: () => void })
        .openCreateGroupModal;
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const hasSeenWelcome = localStorage.getItem(`hasSeenWelcome_${user.uid}`);
    if (!hasSeenWelcome) {
      setShowWelcomePopup(true);
    }

    (async () => {
      try {
        const profile = await getUserProfile();
        const createdAt = profile.createdAt;
        if (
          createdAt &&
          Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000
        ) {
          await resetDemoUserData(user.uid);
          setDataDeletedPopup(true);
        }
      } catch (error) {
        console.error('Error resetting demo data:', error);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setGroups([]);
      return;
    }

    const unsubscribe = subscribeToUserGroups(
      user.uid,
      (fetchedGroups) => {
        setLastError(null);
        setGroups(fetchedGroups);
      },
      (error) => {
        console.error('Error fetching groups:', error);
        setLastError(error instanceof Error ? error.message : String(error));
      },
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!selectedGroupId || !groups.length) return;
    if (!groups.find((g) => g.id === selectedGroupId)) {
      navigate('/', { replace: true });
    }
  }, [groups, selectedGroupId, navigate]);

  if (!user) return null;

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 font-sans selection:bg-indigo-100 selection:text-indigo-900 relative overflow-hidden transition-colors duration-300">
      {process.env.NODE_ENV !== 'production' && (
        <div className="fixed bottom-4 right-4 z-[100] bg-black/80 text-white p-4 rounded-2xl text-[10px] font-mono max-w-xs pointer-events-none">
          <p className="font-bold mb-1 text-indigo-400">DEBUG INFO</p>
          <p>Months: {groups.length}</p>
          <p>User: {user.uid.slice(0, 8)}...</p>
          {lastError && (
            <p className="text-red-400 mt-2">Error: {lastError}</p>
          )}
        </div>
      )}

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={`
        fixed lg:static inset-y-0 left-0 w-72 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-white/5 flex flex-col z-50 lg:z-10 transition-all duration-300 ease-in-out overflow-y-auto custom-scrollbar
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
      >
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-10 dark:opacity-20">
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-indigo-600 rounded-full blur-[100px]" />
          <div className="absolute top-1/2 -right-32 w-64 h-64 bg-fuchsia-600 rounded-full blur-[100px]" />
        </div>

        <div className="p-8 relative z-10 shrink-0">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white font-display">
                Budgeted
              </span>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <nav className="space-y-1.5">
            <button
              onClick={() => {
                goTo('dashboard');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${!selectedGroupId && mainView === 'dashboard' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/10 dark:shadow-white/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span className="font-bold">Dashboard</span>
            </button>
            <button
              onClick={() => {
                goTo('shop');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${!selectedGroupId && mainView === 'shop' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/10 dark:shadow-white/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
            >
              <Scan className="w-5 h-5" />
              <span className="font-bold">Shop</span>
            </button>
            <button
              onClick={() => {
                goTo('purchases');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${!selectedGroupId && mainView === 'purchases' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/10 dark:shadow-white/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
            >
              <Package className="w-5 h-5" />
              <span className="font-bold">Products</span>
            </button>
            <button
              onClick={() => {
                goTo('credits');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${!selectedGroupId && mainView === 'credits' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/10 dark:shadow-white/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
            >
              <Landmark className="w-5 h-5" />
              <span className="font-bold">Loans</span>
            </button>
            <button
              onClick={() => {
                goTo('insurances');
                setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${!selectedGroupId && mainView === 'insurances' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 shadow-xl shadow-zinc-900/10 dark:shadow-white/10' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white'}`}
            >
              <Shield className="w-5 h-5" />
              <span className="font-bold">Insurance</span>
            </button>
            <button
              onClick={() => {
                setIsCategoriesOpen(true);
                setIsSidebarOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white"
            >
              <Tag className="w-5 h-5" />
              <span className="font-bold">Categories</span>
            </button>
          </nav>
        </div>

        <MonthsSidebar
          groups={groups}
          selectedGroupId={selectedGroupId}
          userId={user.uid}
          onSelectGroup={selectGroup}
          onCreateMonth={() => {
            setIsCreateModalOpen(true);
            setIsSidebarOpen(false);
          }}
        />

        <div className="p-6 mt-auto relative z-10 shrink-0">
          <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-2xl border border-zinc-200 dark:border-white/10 mb-4 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <img
                src={
                  user.photoURL ||
                  `https://ui-avatars.com/api/?name=${user.displayName}&background=random`
                }
                alt=""
                className="w-10 h-10 rounded-xl shadow-sm border border-zinc-200 dark:border-white/10"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">
                  {user.displayName}
                </p>
                <p className="text-[10px] text-zinc-500 truncate font-mono">
                  {user.email}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => signOut()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-all duration-300 font-bold text-sm"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
            <button
              onClick={toggleTheme}
              className="p-3 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-900 dark:hover:text-white transition-all duration-300"
              title={
                theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'
              }
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" />
              ) : (
                <Moon className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto relative">
        <div className="lg:hidden flex items-center justify-between p-4 bg-zinc-950 border-b border-white/5 sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-lg flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white font-display">Budgeted</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 text-zinc-400 hover:text-white"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
        <AnimatePresence mode="wait">
          {selectedGroupId ? (
            <motion.div
              key={selectedGroupId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <GroupView
                groupId={selectedGroupId}
                user={user}
                onBack={leaveGroup}
                theme={theme}
              />
            </motion.div>
          ) : mainView === 'shop' ? (
            <motion.div
              key="shop"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-4 sm:p-10 max-w-7xl mx-auto"
            >
              <ShoppingView
                groups={groups}
                defaultGroupId={selectedGroupId}
                onSelectMonth={selectGroup}
              />
            </motion.div>
          ) : mainView === 'purchases' ? (
            <motion.div
              key="purchases"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <PurchasesView onSelectMonth={selectGroup} />
            </motion.div>
          ) : mainView === 'insurances' ? (
            <motion.div
              key="insurances"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <InsurancesView onSelectMonth={selectGroup} />
            </motion.div>
          ) : mainView === 'credits' ? (
            <motion.div
              key="credits"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <CreditsView onSelectMonth={selectGroup} />
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="p-10 max-w-7xl mx-auto"
            >
              <Dashboard
                user={user}
                groups={groups}
                onSelectGroup={selectGroup}
                theme={theme}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {dataDeletedPopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDataDeletedPopup(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[40px] shadow-2xl p-10 text-center"
            >
              <div className="w-20 h-20 bg-orange-50 dark:bg-orange-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-500/20">
                <Settings className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-display">
                Demo Data Reset
              </h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-10 leading-relaxed text-sm">
                Your data has been deleted because 24 hours have passed since you
                first signed in. This is a demo application.
              </p>
              <button
                onClick={() => setDataDeletedPopup(false)}
                className="w-full py-4 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all shadow-lg shadow-zinc-200 dark:shadow-black/20 active:scale-95"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CreateGroupModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        user={user}
      />

      <CategoryManagerModal
        isOpen={isCategoriesOpen}
        onClose={() => setIsCategoriesOpen(false)}
      />

      <AnimatePresence>
        {showWelcomePopup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowWelcomePopup(false);
                localStorage.setItem(`hasSeenWelcome_${user.uid}`, 'true');
              }}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[40px] shadow-2xl p-10 text-center"
            >
              <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                <LayoutDashboard className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white mb-4 font-display">
                Welcome!
              </h3>
              <p className="text-zinc-500 dark:text-zinc-400 mb-10 leading-relaxed text-sm">
                You&apos;re connected to Budgeted. Track expenses, split bills,
                and manage shared budgets.
              </p>
              <button
                onClick={() => {
                  setShowWelcomePopup(false);
                  localStorage.setItem(`hasSeenWelcome_${user.uid}`, 'true');
                }}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
              >
                Got it, let&apos;s go!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
