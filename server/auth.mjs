import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

const JWT_SECRET =
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES ?? '7d';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function newUserId() {
  return randomUUID();
}

export function rowToAppUser(row) {
  return {
    uid: row.id,
    email: row.email,
    displayName: row.display_name ?? row.email,
    photoURL: row.photo_url ?? null,
    emailVerified: true,
  };
}
