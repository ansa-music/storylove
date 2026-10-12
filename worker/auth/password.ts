import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../shared/constants.ts';
import { bytesEqual, fromBase64, randomBytes, toBase64 } from '../lib/crypto.ts';
import { validationFailed } from '../lib/errors.ts';

const encoder = new TextEncoder();
const ALGORITHM = 'pbkdf2-sha256';
// 100 000 итераций — значение из проекта: исторически это потолок PBKDF2 в боевой среде Workers.
// Локальный workerd 1.20261006.1 потолок НЕ применяет (проверено: 100 001…5 000 000 проходят,
// 600 000 ≈ 0,8 с), боевую среду отсюда проверить нельзя. Поднимать — только после проверки
// на выпущенном Worker; старые хеши останутся рабочими: число итераций записано в самой строке
// (verifyPassword принимает значения не выше текущего ITERATIONS).
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

/** HMAC-SHA256(пароль, SESSION_PEPPER): без секрета сервера хеши из базы перебирать бесполезно. */
async function applyPepper(password: string, pepper: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(password));
}

async function derive(
  password: string,
  pepper: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const peppered = await applyPepper(password, pepper);
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Формат: pbkdf2-sha256$100000$<salt_b64>$<hash_b64>. */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, pepper, salt, ITERATIONS);
  return `${ALGORITHM}$${String(ITERATIONS)}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string, pepper: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterationsText);
  const salt = saltText === undefined ? null : fromBase64(saltText);
  const expected = hashText === undefined ? null : fromBase64(hashText);
  if (
    algorithm !== ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > ITERATIONS ||
    !salt ||
    !expected
  ) {
    return false;
  }
  const actual = await derive(password, pepper, salt, iterations);
  return bytesEqual(actual, expected);
}

/**
 * Фиктивное хеширование для несуществующего email: ответ занимает столько же времени,
 * сколько проверка настоящего пароля, и по времени нельзя узнать, есть ли такой администратор.
 */
export async function burnPasswordCheck(password: string, pepper: string): Promise<void> {
  await derive(password, pepper, new Uint8Array(SALT_BYTES), ITERATIONS);
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw validationFailed(
      `Пароль должен быть длиной от ${String(PASSWORD_MIN_LENGTH)} до ${String(PASSWORD_MAX_LENGTH)} символов.`,
    );
  }
}
