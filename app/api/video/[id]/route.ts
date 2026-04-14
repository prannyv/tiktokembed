import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

type RouteParams = {
  params: Promise<{ id: string }>;
};

/**
 * Video proxy — iMessage's crawler hits this URL (referenced in og:video).
 * We fetch the play URL from tikwm, then stream the actual video from
 * TikTok's CDN back to the client. This avoids TikTok CDN's broken HEAD
 * responses that cause iMessage link previews to fail.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  const playUrl = await getPlayUrl(id);
  if (!playUrl) {
    return new NextResponse('Video not found', { status: 404 });
  }

  const upstreamHeaders: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  // Forward range requests so crawlers/browsers can do partial fetches
  const rangeHeader = req.headers.get('range');
  if (rangeHeader) {
    upstreamHeaders['Range'] = rangeHeader;
  }

  const upstream = await fetch(playUrl, { headers: upstreamHeaders });

  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse('Upstream error', { status: 502 });
  }

  const responseHeaders = new Headers();
  responseHeaders.set('Content-Type', 'video/mp4');
  responseHeaders.set('Accept-Ranges', 'bytes');
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set('Cache-Control', 'public, max-age=600, s-maxage=600');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) responseHeaders.set('Content-Length', contentLength);

  const contentRange = upstream.headers.get('content-range');
  if (contentRange) responseHeaders.set('Content-Range', contentRange);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

/**
 * HEAD — returns correct headers without streaming the body.
 * Critical because TikTok CDN returns 504 on HEAD requests,
 * but iMessage's crawler uses HEAD to validate og:video URLs.
 */
export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=600, s-maxage=600',
    },
  });
}

async function getPlayUrl(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.tikwm.com/api/?url=${encodeURIComponent(`https://www.tiktok.com/@_/video/${videoId}`)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return null;

    const json = await res.json();
    return json?.data?.play || null;
  } catch {
    return null;
  }
}
