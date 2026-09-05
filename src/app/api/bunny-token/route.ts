import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

const LIBRARY_ID = '675652';

export async function POST(req: Request) {
  const { videoId } = (await req.json()) as { videoId?: string };
  if (!videoId) return Response.json({ error: 'Missing videoId' }, { status: 400 });

  const expires = Math.floor(Date.now() / 1000) + 4 * 60 * 60;
  const token = createHash('sha256')
    .update(`${process.env.BUNNY_TOKEN_KEY}${videoId}${expires}`)
    .digest('hex');

  const embedUrl =
    `https://player.mediadelivery.net/embed/${LIBRARY_ID}/${videoId}` +
    `?token=${token}&expires=${expires}&autoplay=false&loop=false&muted=false&preload=true&responsive=true`;

  return Response.json({ embedUrl });
}
