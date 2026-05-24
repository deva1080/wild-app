import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { recoverMessageAddress } from 'viem';
import { signSession, COOKIE_NAME } from '@/lib/server/auth';

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { address, message, signature } = await request.json();

    if (!address || !message || !signature) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Verify the message is fresh (prevent replay of captured signatures)
    const issuedAtMatch = (message as string).match(/Issued At: (.+)/);
    if (!issuedAtMatch) {
      return NextResponse.json({ error: 'Invalid message format' }, { status: 400 });
    }
    const issuedAt = new Date(issuedAtMatch[1]).getTime();
    if (Number.isNaN(issuedAt) || Date.now() - issuedAt > MAX_AGE_MS) {
      return NextResponse.json({ error: 'Message expired' }, { status: 401 });
    }

    // Recover the signer from the signature and compare with claimed address
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() !== (address as string).toLowerCase()) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const token = await signSession(address as string);

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24, // 24h — matches JWT expiry, survives browser restarts
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[auth/wallet]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
