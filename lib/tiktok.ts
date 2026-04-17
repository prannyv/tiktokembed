export interface TikTokVideoData {
  id: string;
  title: string;
  author: string;
  videoUrl: string;
  hdVideoUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

/**
 * Extract the numeric video ID from a TikTok URL.
 * e.g. "https://www.tiktok.com/@user/video/7550389730706345271" → "7550389730706345271"
 */
export function extractVideoId(tiktokUrl: string): string {
  const match = tiktokUrl.match(/\/video\/(\d+)/);
  return match?.[1] ?? '';
}

/**
 * Short TikTok URLs (vt.tiktok.com, vm.tiktok.com) redirect to the full
 * canonical URL. Follow the redirect chain to resolve it.
 */
export async function resolveShortUrl(shortPath: string): Promise<string | null> {
  const shortDomains = ['vt.tiktok.com', 'vm.tiktok.com', 'www.tiktok.com'];

  for (const domain of shortDomains) {
    try {
      const res = await fetch(`https://${domain}/${shortPath}`, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      const finalUrl = res.url;
      if (finalUrl && finalUrl.includes('tiktok.com/') && finalUrl.includes('/video/')) {
        return finalUrl;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Returns true if the path looks like a standard TikTok video path
 * (e.g. @user/video/123), false if it's likely a short code.
 */
export function isCanonicalPath(pathSegments: string[]): boolean {
  return pathSegments.length >= 1 && pathSegments[0].startsWith('@');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TikwmResponse = { code: number; msg: string; data: any };

/**
 * Fetch video metadata from the tikwm API.
 *
 * Uses Next.js Data Cache (revalidate: 600) as the shared cache layer.
 * This cache is stored on disk and shared across all serverless function
 * instances — so a /api/warm call populates it for the catch-all route too.
 */
export async function getTikTokVideoData(tiktokUrl: string): Promise<TikTokVideoData> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`;

  const res = await fetch(apiUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
    next: { revalidate: 600 }, // 10 min — shared across all function instances via Next.js Data Cache
  });

  if (!res.ok) {
    throw new Error(`tikwm API error: ${res.status} ${res.statusText}`);
  }

  const json: TikwmResponse = await res.json();

  if (json.code !== 0 || !json.data) {
    throw new Error(`tikwm error: ${json.msg}`);
  }

  const d = json.data;
  const videoUrl: string = d.play || '';
  const hdVideoUrl: string = d.hdplay || d.play || '';
  // Prefer JPEG cover over WebP origin_cover — iMessage doesn't reliably preview WebP
  const thumbnailUrl: string = d.cover || d.origin_cover || '';
  const id: string = d.id || extractVideoId(tiktokUrl);

  if (!videoUrl) {
    throw new Error('tikwm response missing play URL');
  }

  return {
    id,
    title: d.title || 'TikTok Video',
    author: d.author?.nickname || d.author?.unique_id || 'Unknown',
    videoUrl,
    hdVideoUrl,
    thumbnailUrl,
    width: d.width || 576,
    height: d.height || 1024,
  };
}
