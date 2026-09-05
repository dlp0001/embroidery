import handler from '@/server/legacy/webhook-polar.js';
import { runLegacy } from '@/lib/legacy-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return runLegacy(handler as never, req);
}
