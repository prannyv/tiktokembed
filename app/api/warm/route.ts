import { after } from 'next/server';
import { NextRequest, NextResponse } from 'next/server';
import { getTikTokVideoData, isCanonicalPath, resolveShortUrl, extractVideoId } from '@/lib/tiktok';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://tiktokembed.vercel.app';

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  try {
    let tiktokUrl: string;

    const isFullUrl = rawUrl.startsWith('http');
    if (isFullUrl) {
      tiktokUrl = rawUrl;
    } else {
      const segments = rawUrl.replace(/^\//, '').split('/');
      if (isCanonicalPath(segments)) {
        tiktokUrl = `https://www.tiktok.com/${segments.join('/')}`;
      } else {
        const resolved = await resolveShortUrl(segments.join('/'));
        tiktokUrl = resolved ?? `https://www.tiktok.com/${segments.join('/')}`;
      }
    }

    // Prime the Next.js Data Cache so the catch-all route gets a cache hit
    const data = await getTikTokVideoData(tiktokUrl);

    // Background: prime the ISR page cache and video proxy CDN cache.
    // Runs after the response is sent so the shortcut gets a fast reply.
    after(async () => {
      const videoId = data.id || extractVideoId(tiktokUrl);
      if (!videoId) return;

      const fetches: Promise<unknown>[] = [];

      // Prime ISR page cache by hitting the page URL
      const pagePath = tiktokUrl.replace('https://www.tiktok.com/', '');
      fetches.push(
        fetch(`${SITE_URL}/${pagePath}`, {
          method: 'GET',
          headers: { 'User-Agent': 'TikTokEmbed-Warmup/1.0' },
        }).catch(() => {})
      );

      // Prime the video proxy CDN cache with a small range request
      fetches.push(
        fetch(`${SITE_URL}/api/video/${videoId}`, {
          method: 'GET',
          headers: {
            'User-Agent': 'TikTokEmbed-Warmup/1.0',
            Range: 'bytes=0-1',
          },
        }).catch(() => {})
      );

      await Promise.allSettled(fetches);
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/warm]', message);
    return NextResponse.json({ success: false, error: message }, { status: 200 });
  }
}
