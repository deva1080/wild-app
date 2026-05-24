import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Address } from 'viem';
import { executeSettleBet } from '@/lib/server/gameCaller';
import { verifySession, COOKIE_NAME } from '@/lib/server/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const session = token ? await verifySession(token) : null;

    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { gameAddress, betId } = body;

    console.log('[settle-bet] Request:', { gameAddress, betId });

    if (!gameAddress || !betId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: gameAddress, betId' },
        { status: 400 }
      );
    }

    const result = await executeSettleBet({
      gameAddress: gameAddress as Address,
      betId: BigInt(betId),
    });

    console.log('[settle-bet] Tx sent:', result.hash);

    return NextResponse.json({
      success: true,
      txHash: result.hash,
    });
  } catch (error) {
    console.error('[settle-bet] ERROR:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
