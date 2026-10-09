import { courseBySlug, deviceAccess } from '@/lib/course';
import { EMBROIDERY_MATERIALS } from '@/server/course/embroidery-materials';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Список материалов — часть курса: открывается тем же доступом, что и уроки. */
const PAGES: Record<string, string> = {
  embroidery: EMBROIDERY_MATERIALS,
};

export async function GET(req: Request, { params }: { params: Promise<{ course: string }> }) {
  const { course: slug } = await params;
  const page = PAGES[slug];
  const course = page ? await courseBySlug(slug) : null;
  if (!course) return new Response('Not found', { status: 404 });

  const access = await deviceAccess(course);
  if (!access || access.expired) {
    return Response.redirect(new URL(`/learn/${slug}`, req.url), 303);
  }
  return new Response(page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
