import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { Address, Hex } from 'viem';
import { executeDelegatedPlay } from '@/lib/server/gameCaller';
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
    const { game, player, token: gameToken, amount, gameChoice, useCredits } = body;

    console.log('[play-delegated] Request:', { game, player, amount, useCredits });

    if (!game || !player || !gameToken || !amount || !gameChoice) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: game, player, token, amount, gameChoice' },
        { status: 400 }
      );
    }

    if (session.address.toLowerCase() !== (player as string).toLowerCase()) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { hash } = await executeDelegatedPlay({
      game: game as Address,
      player: player as Address,
      token: gameToken as Address,
      amount: BigInt(amount),
      gameChoice: gameChoice as Hex,
      useCredits: Boolean(useCredits),
    });

    console.log('[play-delegated] Tx sent:', hash);

    return NextResponse.json({
      success: true,
      txHash: hash,
    });
  } catch (error) {
    console.error('[play-delegated] ERROR:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
