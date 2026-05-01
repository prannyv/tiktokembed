import { NextRequest } from 'next/server';
import { getTikTokVideoData } from '@/lib/tiktok';

type RouteParams = {
  params: Promise<{ path: string[] }>;
};

type EmbedData = {
  videoUrl: string;
  title: string;
  image: string;
  width: number;
  height: number;
};

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://tiktokembed.vercel.app').replace(
  /\/$/,
  ''
);

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { path } = await params;
  const platform = detectPlatform(path);
  const videoId = extractVideoIdFromPath(path, platform);
  const originalUrl = buildOriginalUrl(path, platform);
  const viewerUrl = buildViewerUrl(path);
  const cachedVideoUrl = await getCachedVideoUrl(videoId);
  const embedData = await getEmbedData(originalUrl, platform, cachedVideoUrl);
  const html = buildHtml(embedData, viewerUrl);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function detectPlatform(path: string[]): 'instagram' | 'tiktok' {
  return path[0] === 'reel' || path.includes('reel') ? 'instagram' : 'tiktok';
}

function extractVideoIdFromPath(path: string[], platform: 'instagram' | 'tiktok'): string {
  const joinedPath = `/${path.join('/')}`;
  const match =
    platform === 'instagram'
      ? joinedPath.match(/\/reel\/([A-Za-z0-9_-]+)/)
      : joinedPath.match(/\/video\/(\d{15,25})/);

  return match?.[1] ?? '';
}

function buildOriginalUrl(path: string[], platform: 'instagram' | 'tiktok'): string {
  const joinedPath = path.join('/');
  const host = platform === 'instagram' ? 'www.instagram.com' : 'www.tiktok.com';
  return `https://${host}/${joinedPath}`;
}

async function getEmbedData(
  originalUrl: string,
  platform: 'instagram' | 'tiktok',
  cachedVideoUrl: string | null
): Promise<EmbedData> {
  const fallback: EmbedData = {
    videoUrl: cachedVideoUrl ?? '',
    title: platform === 'instagram' ? 'Instagram Reel' : 'TikTok Video',
    image: '',
    width: 576,
    height: 1024,
  };

  if (platform === 'instagram') {
    return fallback;
  }

  try {
    const data = await getTikTokVideoData(originalUrl);
    return {
      videoUrl: cachedVideoUrl ?? data.videoUrl ?? data.hdVideoUrl,
      title: data.title || fallback.title,
      image: data.thumbnailUrl || '',
      width: data.width || fallback.width,
      height: data.height || fallback.height,
    };
  } catch {
    return fallback;
  }
}

async function getCachedVideoUrl(videoId: string): Promise<string | null> {
  if (!videoId) return null;

  const accountId = process.env.CF_ACCOUNT_ID;
  const namespace = process.env.CF_KV_NAMESPACE;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !namespace || !token) return null;

  try {
    const key = `videos:${videoId}`;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`,
      {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) return null;

    const value = await res.text();
    return isValidVideoUrl(value) ? value : null;
  } catch {
    return null;
  }
}

function buildViewerUrl(path: string[]): string {
  return `${SITE_URL}/view/${path.join('/')}`;
}

function buildHtml(data: EmbedData, redirectUrl: string): string {
  const title = attr(data.title.slice(0, 90));
  const video = attr(data.videoUrl);
  const image = attr(data.image);
  const redirect = attr(redirectUrl);
  const jsRedirect = jsString(redirectUrl);

  let html = `<meta property="og:video" content="${video}"><meta property="og:video:secure_url" content="${video}"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="${data.width}"><meta property="og:video:height" content="${data.height}"><meta property="og:type" content="video.other"><meta property="og:title" content="${title}"><meta property="og:image" content="${image}"><meta http-equiv="refresh" content="0;url=${redirect}"><script>location.replace("${jsRedirect}")</script>`;

  if (html.length > 1000) {
    html = html.replace(`content="${image}"`, 'content=""');
  }

  return html;
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function jsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\u003c');
}

function isValidVideoUrl(value: string): boolean {
  if (!value || value === 'pending') return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.includes('.') &&
      url.hostname !== 'https' &&
      url.pathname.endsWith('.mp4')
    );
  } catch {
    return false;
  }
}
