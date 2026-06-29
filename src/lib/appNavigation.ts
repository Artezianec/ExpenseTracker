export type MainView =
  | 'dashboard'
  | 'purchases'
  | 'shop'
  | 'credits'
  | 'insurances';

const MAIN_VIEWS = new Set<MainView>([
  'dashboard',
  'purchases',
  'shop',
  'credits',
  'insurances',
]);

export function appPath(mainView: MainView, groupId?: string | null): string {
  if (groupId) return `/month/${groupId}`;
  if (mainView === 'dashboard') return '/';
  return `/${mainView}`;
}

export function parseAppPath(pathname: string): {
  mainView: MainView;
  groupId: string | null;
} {
  const path = pathname.replace(/\/+$/, '') || '/';

  const monthMatch = path.match(/^\/month\/([^/]+)$/);
  if (monthMatch) {
    return { mainView: 'dashboard', groupId: monthMatch[1] };
  }

  const segment = path === '/' ? '' : path.slice(1).split('/')[0];
  if (segment && MAIN_VIEWS.has(segment as MainView) && segment !== 'dashboard') {
    return { mainView: segment as MainView, groupId: null };
  }

  return { mainView: 'dashboard', groupId: null };
}
