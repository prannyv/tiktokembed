import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { after, NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type CobaltResponse = {
  status?: string;
  url?: string;
  text?: string;
  error?: string;
};

const PENDING_TTL_SECONDS = 60;
const WARMED_TTL_SECONDS = 48 * 60 * 60;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://tiktokembed.vercel.app').replace(
  /\/$/,
  ''
);

/*
 * iOS Shortcut update for Instagram Reels:
 * 1. After the existing TikTok domain replace steps, add matching Instagram steps.
 * 2. Replace instagram.com with tiktokembed.vercel.app in the URL.
 * 3. Strip query parameters before sending by using "Get URLs from" or text
 *    manipulation to remove everything after "?".
 * 4. Fire the same /api/warm?url=OriginalURL call with the clean Instagram URL.
 * 5. Leave the rest of the shortcut, including the send message step, unchanged.
 */
export async function GET(req: NextRequest) {
  const tiktokUrl = req.nextUrl.searchParams.get('url');
  if (!tiktokUrl) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  console.log('[/api/warm] COBALT_URL =', process.env.COBALT_URL);

  const resolvedUrl = await resolveUrl(tiktokUrl);
  const videoId = extractVideoId(resolvedUrl);
  const url = videoId ? buildCanonicalUrl(resolvedUrl, videoId) : null;

  after(async () => {
    await warmVideo(tiktokUrl, resolvedUrl, videoId);
  });

  return NextResponse.json({ success: true, url }, { status: 200 });
}

async function warmVideo(originalUrl: string, resolvedUrl: string, videoId: string) {
  try {
    console.log('[/api/warm] resolved URL and video ID', {
      originalUrl,
      resolvedUrl,
      videoId,
    });

    if (!videoId) {
      console.error('[/api/warm] could not extract video ID', { originalUrl, resolvedUrl });
      return;
    }

    const kvKey = `videos:${videoId}`;
    const existingValue = await getKvValue(kvKey);

    if (existingValue === 'pending') {
      console.log('[/api/warm] already pending', { videoId });
      return;
    }

    if (existingValue) {
      console.log('[/api/warm] already warmed', { videoId });
      return;
    }

    await putKvValue(kvKey, 'pending', PENDING_TTL_SECONDS);

    console.log('[/api/warm] cobalt request started', {
      videoId,
      timestamp: new Date().toISOString(),
    });

    const cobaltResponse = await fetch(requiredEnv('COBALT_URL'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ url: resolvedUrl }),
    });

    const cobaltJson = (await cobaltResponse.json().catch(() => null)) as CobaltResponse | null;
    if (
      !cobaltResponse.ok ||
      !cobaltJson?.url ||
      (cobaltJson.status !== 'tunnel' && cobaltJson.status !== 'redirect')
    ) {
      console.error('[/api/warm] cobalt did not return a video URL', {
        videoId,
        statusCode: cobaltResponse.status,
        response: cobaltJson,
      });
      return;
    }

    const videoResponse = await fetch(cobaltJson.url);
    console.log('[/api/warm] cobalt stream started', {
      videoId,
      timestamp: new Date().toISOString(),
    });

    if (!videoResponse.ok || !videoResponse.body) {
      console.error('[/api/warm] cobalt video fetch failed', {
        videoId,
        statusCode: videoResponse.status,
      });
      return;
    }

    await uploadVideoToR2(videoId, videoResponse.body);
    console.log('[/api/warm] R2 upload completed', {
      videoId,
      timestamp: new Date().toISOString(),
    });

    const r2PublicUrl = requiredEnv('CF_R2_PUBLIC_URL').replace(/\/$/, '');
    const publicUrl = `${r2PublicUrl}/videos/${videoId}.mp4`;
    await putKvValue(kvKey, publicUrl, WARMED_TTL_SECONDS);
    console.log('[/api/warm] KV write completed', {
      videoId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[/api/warm] warm job failed', error);
  }
}

async function resolveUrl(rawUrl: string): Promise<string> {
  const platform = detectPlatform(rawUrl);

  if (platform !== 'tiktok' || (!isTikTokShortLink(rawUrl) && hasTikTokVideoId(rawUrl))) {
    return rawUrl;
  }

  try {
    const res = await fetch(rawUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    return res.url || rawUrl;
  } catch (error) {
    console.error('[/api/warm] failed to resolve TikTok short URL', { rawUrl, error });
    return rawUrl;
  }
}

function extractVideoId(url: string): string {
  const platform = detectPlatform(url);

  if (platform === 'tiktok') {
    const match = url.match(/\/video\/(\d{15,25})/);
    return match?.[1] ?? '';
  }

  if (platform === 'instagram') {
    const match = url.match(/\/reel\/([A-Za-z0-9_-]+)/);
    return match?.[1] ?? '';
  }

  return '';
}

function detectPlatform(rawUrl: string): 'tiktok' | 'instagram' | 'unknown' {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();

    if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) {
      return 'tiktok';
    }

    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) {
      return 'instagram';
    }
  } catch {
    if (rawUrl.includes('tiktok.com')) return 'tiktok';
    if (rawUrl.includes('instagram.com')) return 'instagram';
  }

  return 'unknown';
}

function isTikTokShortLink(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com';
  } catch {
    return rawUrl.includes('vm.tiktok.com') || rawUrl.includes('vt.tiktok.com');
  }
}

function hasTikTokVideoId(rawUrl: string): boolean {
  return /\/video\/\d{15,25}/.test(rawUrl);
}

function buildCanonicalUrl(sourceUrl: string, videoId: string): string {
  const platform = detectPlatform(sourceUrl);

  if (platform === 'instagram') {
    return `${SITE_URL}/reel/${videoId}`;
  }

  try {
    const url = new URL(sourceUrl);
    return `${SITE_URL}${url.pathname}`;
  } catch {
    const path = sourceUrl.startsWith('/') ? sourceUrl : `/${sourceUrl}`;
    return `${SITE_URL}${path.split('?')[0]}`;
  }
}

async function getKvValue(key: string): Promise<string | null> {
  const res = await fetch(kvUrl(key), {
    headers: {
      Authorization: `Bearer ${requiredEnv('CF_API_TOKEN')}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`KV read failed: ${res.status} ${await res.text()}`);
  }

  return res.text();
}

async function putKvValue(key: string, value: string, expirationTtl: number) {
  const res = await fetch(kvUrl(key, expirationTtl), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${requiredEnv('CF_API_TOKEN')}`,
      'Content-Type': 'text/plain',
    },
    body: value,
  });

  if (!res.ok) {
    throw new Error(`KV write failed: ${res.status} ${await res.text()}`);
  }
}

function kvUrl(key: string, expirationTtl?: number): string {
  const accountId = requiredEnv('CF_ACCOUNT_ID');
  const namespace = requiredEnv('CF_KV_NAMESPACE');
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`
  );

  if (expirationTtl) {
    url.searchParams.set('expiration_ttl', String(expirationTtl));
  }

  return url.toString();
}

async function uploadVideoToR2(videoId: string, body: ReadableStream<Uint8Array>) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${requiredEnv('CF_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv('CF_R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('CF_R2_SECRET_ACCESS_KEY'),
    },
  });

  const upload = new Upload({
    client,
    params: {
      Bucket: requiredEnv('CF_R2_BUCKET'),
      Key: `videos/${videoId}.mp4`,
      ContentType: 'video/mp4',
      Body: body,
    },
  });

  await upload.done();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}
