import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Password hashing with Node's built-in scrypt (memory-hard; an OWASP-listed
// algorithm) so no native dependency is needed (architecture §40).
// Stored format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>, so parameters can be
// raised later without breaking existing hashes.

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, keylen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

const maxmem = (n: number, r: number) => 256 * n * r;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { ...params, maxmem: maxmem(params.N, params.r) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Verified against when the email is unknown, so response time does not reveal
// whether an account exists.
export const DUMMY_PASSWORD_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
