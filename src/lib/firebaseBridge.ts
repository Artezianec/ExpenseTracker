import { signInAnonymously, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { AppAuthSession } from '@apexstream/client';
import { auth, db } from '../firebase';
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

export async function ensureFirebaseBridge(session: AppAuthSession): Promise<AppUser> {
  const appUser = sessionToAppUser(session);

  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }

  const firebaseUid = auth.currentUser?.uid;
  if (!firebaseUid) {
    throw new Error('Failed to establish Firebase session');
  }

  const userRef = doc(db, 'users', firebaseUid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      uid: appUser.uid,
      apexUserId: appUser.uid,
      displayName: appUser.displayName,
      email: appUser.email,
      photoURL: appUser.photoURL,
      createdAt: serverTimestamp(),
    });
  } else {
    const data = userSnap.data();
    await setDoc(
      userRef,
      {
        ...data,
        apexUserId: appUser.uid,
        displayName: appUser.displayName ?? data.displayName,
        email: appUser.email ?? data.email,
        photoURL: appUser.photoURL ?? data.photoURL,
      },
      { merge: true },
    );
  }

  return appUser;
}

export async function signOutFirebaseBridge(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}
