export interface TikTokVideoData {
  title: string;
  author: string;
  videoUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

// In-memory cache to avoid redundant API calls.
// tikwm play URLs expire (hex timestamp in path), so cap at 5 min.
const cache = new Map<string, { data: TikTokVideoData; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns true if a tikwm play URL has likely expired.
 * tikwm URLs don't carry an explicit expire param like TikTok's CDN,
 * so we rely purely on the 5-minute cache TTL instead.
 */
export function isVideoUrlExpired(videoUrl: string): boolean {
  // tikwm URLs don't embed a readable expiry — rely on cache TTL only.
  // Keeping this exported so the page component can call it consistently.
  return !videoUrl;
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

export async function getTikTokVideoData(tiktokUrl: string): Promise<TikTokVideoData> {
  const now = Date.now();
  const cached = cache.get(tiktokUrl);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await fetchFromTikwm(tiktokUrl);
  if (data) {
    cache.set(tiktokUrl, { data, timestamp: now });
    return data;
  }

  throw new Error('Could not fetch TikTok video data');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TikwmResponse = { code: number; msg: string; data: any };

async function fetchFromTikwm(tiktokUrl: string): Promise<TikTokVideoData | null> {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`;

    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      console.error(`tikwm API error: ${res.status} ${res.statusText}`);
      return null;
    }

    const json: TikwmResponse = await res.json();

    if (json.code !== 0 || !json.data) {
      console.error(`tikwm returned error: ${json.msg}`);
      return null;
    }

    const d = json.data;
    const videoUrl: string = d.play || '';
    const thumbnailUrl: string = d.origin_cover || d.cover || '';

    if (!videoUrl) {
      console.error('tikwm response missing play URL');
      return null;
    }

    return {
      title: d.title || 'TikTok Video',
      author: d.author?.nickname || d.author?.unique_id || 'Unknown',
      videoUrl,
      thumbnailUrl,
      width: d.width || 576,
      height: d.height || 1024,
    };
  } catch (e) {
    console.error('fetchFromTikwm error:', e);
    return null;
  }
}
