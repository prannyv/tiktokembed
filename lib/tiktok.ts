export interface TikTokVideoData {
  title: string;
  author: string;
  videoUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

// In-memory cache to avoid refetching within a short window.
// downloadAddr URLs expire (~5-10 min), so we cache for 5 min max.
const cache = new Map<string, { data: TikTokVideoData; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

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
        headers: { 'User-Agent': randomUserAgent() },
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

/**
 * Returns true if a downloadAddr URL has passed its &expire= timestamp.
 * Useful for detecting stale cached URLs when a browser opens the page later.
 */
export function isVideoUrlExpired(videoUrl: string): boolean {
  const match = videoUrl.match(/[?&]expire=(\d+)/);
  if (!match) return false;
  return Date.now() / 1000 > parseInt(match[1], 10);
}

export async function getTikTokVideoData(tiktokUrl: string): Promise<TikTokVideoData> {
  const now = Date.now();
  const cached = cache.get(tiktokUrl);
  // Invalidate cache early if the stored video URL has already expired
  if (cached && now - cached.timestamp < CACHE_TTL_MS && !isVideoUrlExpired(cached.data.videoUrl)) {
    return cached.data;
  }

  const pageData = await fetchFromPage(tiktokUrl);
  if (pageData) {
    cache.set(tiktokUrl, { data: pageData, timestamp: now });
    return pageData;
  }

  const oembedData = await fetchFromOembed(tiktokUrl);
  if (oembedData) {
    cache.set(tiktokUrl, { data: oembedData, timestamp: now });
    return oembedData;
  }

  throw new Error('Could not fetch TikTok video data');
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchFromPage(tiktokUrl: string): Promise<TikTokVideoData | null> {
  try {
    const res = await fetch(tiktokUrl, {
      headers: {
        'User-Agent': randomUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      // Next.js fetch cache — revalidate after 5 min
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      console.error(`TikTok page fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const html = await res.text();

    const match = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s
    );
    if (!match) {
      console.error('__UNIVERSAL_DATA_FOR_REHYDRATION__ not found in TikTok page HTML');
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = JSON.parse(match[1]);

    const videoDetail =
      data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (!videoDetail) {
      console.error('Could not navigate to itemStruct in rehydration JSON');
      return null;
    }

    // downloadAddr (and playAddr) contain unicode escapes like \u002F for /
    const unescape = (s: string) => s.replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );

    const rawDownloadAddr: string =
      videoDetail.video?.downloadAddr || videoDetail.video?.playAddr || '';
    const rawCover: string =
      videoDetail.video?.cover || videoDetail.video?.originCover || '';

    const videoUrl = unescape(rawDownloadAddr);
    const thumbnailUrl = unescape(rawCover);

    if (!videoUrl) {
      console.error('No videoUrl found in itemStruct');
      return null;
    }

    return {
      title: videoDetail.desc || 'TikTok Video',
      author:
        videoDetail.author?.nickname ||
        videoDetail.author?.uniqueId ||
        'Unknown',
      videoUrl,
      thumbnailUrl,
      width: videoDetail.video?.width || 576,
      height: videoDetail.video?.height || 1024,
    };
  } catch (e) {
    console.error('fetchFromPage error:', e);
    return null;
  }
}

async function fetchFromOembed(tiktokUrl: string): Promise<TikTokVideoData | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(tiktokUrl)}`
    );
    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();

    return {
      title: data.title || 'TikTok Video',
      author: data.author_name || 'Unknown',
      videoUrl: '', // oEmbed does not expose a direct .mp4 URL
      thumbnailUrl: data.thumbnail_url || '',
      width: data.thumbnail_width || 576,
      height: data.thumbnail_height || 1024,
    };
  } catch (e) {
    console.error('fetchFromOembed error:', e);
    return null;
  }
}
