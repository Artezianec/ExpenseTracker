import type { AppAuthSession } from '@apexstream/client';
import type { AppUser } from '../types';

export function sessionToAppUser(session: AppAuthSession): AppUser {
  const metadata = session.user.metadata ?? {};
  return {
    uid: session.user.id,
    email: session.user.email,
    displayName:
      (typeof metadata.displayName === 'string' ? metadata.displayName : null) ??
      session.user.email,
    photoURL:
      typeof metadata.photoURL === 'string' ? metadata.photoURL : null,
    emailVerified: session.user.email_verified,
  };
}
