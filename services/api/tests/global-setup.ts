import { execSync } from 'node:child_process';

/** Applies the committed migrations to the TEST database once. Refuses to touch anything else. */
export default function setup() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/\/[^/?]*_test(\?|$)/.test(url)) {
    throw new Error(`Refusing to run tests: DATABASE_URL must point at a database whose name ends in _test (got ${url.replace(/:[^:@]*@/, ':***@')})`);
  }
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
