import { NextRequest, NextResponse } from 'next/server';
import { getTikTokVideoData, isCanonicalPath, resolveShortUrl } from '@/lib/tiktok';

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  try {
    // Normalise: strip any domain prefix so we get just the path segments.
    // Handles both full URLs (https://tiktok.com/@user/video/123) and raw paths.
    let tiktokUrl: string;

    const isFullUrl = rawUrl.startsWith('http');
    if (isFullUrl) {
      // If it's already a full TikTok URL, use it directly
      tiktokUrl = rawUrl;
    } else {
      // Treat it as a path and reconstruct
      const segments = rawUrl.replace(/^\//, '').split('/');
      if (isCanonicalPath(segments)) {
        tiktokUrl = `https://www.tiktok.com/${segments.join('/')}`;
      } else {
        // Short code — resolve the redirect
        const resolved = await resolveShortUrl(segments.join('/'));
        tiktokUrl = resolved ?? `https://www.tiktok.com/${segments.join('/')}`;
      }
    }

    // Calling getTikTokVideoData populates the Next.js Data Cache for this URL.
    // When the catch-all route renders the same URL, it gets a cache hit.
    await getTikTokVideoData(tiktokUrl);

    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/warm]', message);
    // Return success anyway — a warm failure is non-fatal; the catch-all
    // route will fetch live if needed.
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
