import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { settings } from './config';
import { utcnow } from './timeutil';

export type TokenType = 'access' | 'refresh';

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, { type: argon2.argon2id });

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export const needsRehash = (hash: string): boolean => argon2.needsRehash(hash);

export interface Issued {
  token: string;
  jti: string;
  expiresAt: Date;
}

export function createToken(userId: number, kind: TokenType): Issued {
  const s = settings();
  const now = utcnow();
  const ttlMs = kind === 'access' ? s.JWT_ACCESS_MINUTES * 60_000 : s.JWT_REFRESH_DAYS * 86_400_000;
  const expiresAt = new Date(now.getTime() + ttlMs);
  const jti = randomUUID().replace(/-/g, '');
  const token = jwt.sign(
    { sub: String(userId), type: kind, jti, iat: Math.floor(now.getTime() / 1000), exp: Math.floor(expiresAt.getTime() / 1000) },
    s.JWT_SECRET,
    { algorithm: 'HS256' },
  );
  return { token, jti, expiresAt };
}

export interface TokenData {
  sub: string;
  jti: string;
  type: TokenType;
}

export function decodeToken(token: string, kind: TokenType): TokenData | null {
  try {
    const data = jwt.verify(token, settings().JWT_SECRET, { algorithms: ['HS256'], clockTimestamp: Math.floor(utcnow().getTime() / 1000) }) as TokenData;
    return data.type === kind ? data : null;
  } catch {
    return null;
  }
}
