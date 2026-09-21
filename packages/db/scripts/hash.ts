import { randomBytes, scrypt as _scrypt } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(_scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

/** نفس صيغة apps/api/src/auth.ts — تُبقى متطابقةً بالاختبار أدناه. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
