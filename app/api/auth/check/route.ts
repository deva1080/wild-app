import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySession, COOKIE_NAME } from '@/lib/server/auth';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, address: session.address });
}
