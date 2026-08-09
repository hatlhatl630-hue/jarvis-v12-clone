import { NextResponse } from 'next/server';
import { getProviders, setCloudflareAI } from '@/lib/router';

export async function GET() {
  // Try to get CF AI binding
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env }: any = await getCloudflareContext({ async: true });
    if ((env as any)?.AI) setCloudflareAI((env as any).AI);
  } catch {}

  return NextResponse.json({
    status: 'ok',
    timestamp: Date.now(),
    providers: getProviders(),
  });
}
