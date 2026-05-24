import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = 'wb-auth';
const SESSION_DURATION = '24h';

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing JWT_SECRET environment variable');
  return new TextEncoder().encode(secret);
}

export async function signSession(address: string): Promise<string> {
  return new SignJWT({ address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<{ address: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.address !== 'string') return null;
    return { address: payload.address };
  } catch {
    return null;
  }
}
