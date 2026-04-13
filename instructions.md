# TikTok iMessage Video Embedder

## Goal

Build a Next.js app that makes TikTok videos play inline in iMessage, the same way YouTube links do. Users share a link like `yourdomain.com/@user/video/123` in iMessage, and the recipient sees a playable video preview — no TikTok app required.

## How It Works

```
TikTok link: tiktok.com/@itsitorri/video/7550389730706345271
                              ↓
iOS Shortcut: string-replace "tiktok.com" → "yourdomain.com"
                              ↓
Share rewritten URL in iMessage
                              ↓
iMessage link preview crawler hits yourdomain.com/@itsitorri/video/7550389730706345271
                              ↓
Next.js server:
  1. Fetches the original TikTok page server-side
  2. Parses __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON from page HTML
  3. Extracts: downloadAddr (.mp4 URL), thumbnail, title, author
  4. Serves HTML with og:video, og:image, og:title meta tags
                              ↓
iMessage renders inline playable video preview
```

## Verified Architecture (via manual testing)

### TikTok oEmbed API
- **Endpoint:** `https://www.tiktok.com/oembed?url=<TIKTOK_URL>`
- **Returns:** `title`, `author_name`, `author_url`, `thumbnail_url`, `html` (blockquote embed)
- **Does NOT return:** direct `.mp4` video URL
- **Use for:** title, author, thumbnail as fallback

### TikTok Page Scraping
- **Confirmed:** TikTok video pages contain a `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON blob in the HTML
- **Confirmed:** This blob contains a `downloadAddr` field with a **direct `.mp4` video URL**
- **Example downloadAddr format:** `https://v16-webapp-prime.tiktok.com/video/tos/maliva/...?a=1988&...&expire=TIMESTAMP&signature=HASH`
- **Extract with:** `curl -s -H "User-Agent: Mozilla/5.0" "<TIKTOK_URL>" | grep -o '"downloadAddr":"[^"]*"'`

### Important: Expiring URLs
- The `downloadAddr` URLs contain `&expire=TIMESTAMP` — they are **time-limited**
- Your server must fetch a fresh video URL on each request, or cache briefly (e.g. 5-10 minutes max)
- Do NOT store these URLs long-term

## Tech Stack

- **Framework:** Next.js (App Router)
- **Deployment:** Vercel
- **Language:** TypeScript
- **No database needed** — everything is fetched on-demand

## Project Structure

```
tiktok-embed/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                          # Landing/home page (optional)
│   └── [...path]/
│       └── page.tsx                      # Catch-all route for TikTok paths
├── lib/
│   └── tiktok.ts                         # TikTok fetching + parsing logic
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Implementation Details

### 1. Catch-All Route (`app/[...path]/page.tsx`)

This route handles any path like `/@user/video/123456` and serves the appropriate OG tags.

**Server Component** — must be a server component so meta tags are present when iMessage's crawler hits the page.

Use `generateMetadata` to dynamically set OG tags:

```ts
// app/[...path]/page.tsx
import { Metadata } from 'next';
import { getTikTokVideoData } from '@/lib/tiktok';

type Props = {
  params: Promise<{ path: string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const tiktokUrl = `https://www.tiktok.com/${path.join('/')}`;
  const data = await getTikTokVideoData(tiktokUrl);

  return {
    title: data.title,
    openGraph: {
      title: data.title,
      description: `${data.author} on TikTok`,
      type: 'video.other',
      videos: [
        {
          url: data.videoUrl,       // direct .mp4 URL
          type: 'video/mp4',
          width: data.width,
          height: data.height,
        },
      ],
      images: [
        {
          url: data.thumbnailUrl,
        },
      ],
    },
    // Twitter/other card tags for broader compatibility
    twitter: {
      card: 'player',
      title: data.title,
      description: `${data.author} on TikTok`,
      images: [data.thumbnailUrl],
    },
  };
}

export default async function TikTokPage({ params }: Props) {
  const { path } = await params;
  const tiktokUrl = `https://www.tiktok.com/${path.join('/')}`;
  const data = await getTikTokVideoData(tiktokUrl);

  // Browser fallback: show an embedded player or redirect
  return (
    <div>
      <video
        src={data.videoUrl}
        poster={data.thumbnailUrl}
        controls
        autoPlay
        playsInline
        style={{ maxWidth: '100%', maxHeight: '100vh' }}
      />
      <p>
        <a href={tiktokUrl}>View on TikTok</a>
      </p>
    </div>
  );
}
```

### 2. TikTok Data Fetcher (`lib/tiktok.ts`)

```ts
// lib/tiktok.ts

export interface TikTokVideoData {
  title: string;
  author: string;
  videoUrl: string;       // direct .mp4 downloadAddr
  thumbnailUrl: string;
  width: number;
  height: number;
}

export async function getTikTokVideoData(tiktokUrl: string): Promise<TikTokVideoData> {
  // Strategy 1: Scrape the page for __UNIVERSAL_DATA_FOR_REHYDRATION__
  const pageData = await fetchFromPage(tiktokUrl);
  if (pageData) return pageData;

  // Strategy 2: Fall back to oEmbed API (no direct video URL, but gets metadata)
  const oembedData = await fetchFromOembed(tiktokUrl);
  if (oembedData) return oembedData;

  throw new Error('Could not fetch TikTok video data');
}

async function fetchFromPage(tiktokUrl: string): Promise<TikTokVideoData | null> {
  try {
    const res = await fetch(tiktokUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: 300 }, // cache for 5 min
    });

    const html = await res.text();

    // Extract the rehydration JSON
    const match = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)<\/script>/s
    );
    if (!match) return null;

    const data = JSON.parse(match[1]);

    // Navigate the JSON to find video data
    // The exact path may vary — inspect the JSON structure
    // Common paths:
    //   data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct
    //   or similar nested structure
    const videoDetail = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (!videoDetail) return null;

    // Extract downloadAddr — it's URL-encoded with \u002F for /
    const downloadAddr = videoDetail.video?.downloadAddr
      ?.replace(/\\u002F/g, '/');

    return {
      title: videoDetail.desc || 'TikTok Video',
      author: videoDetail.author?.nickname || videoDetail.author?.uniqueId || 'Unknown',
      videoUrl: downloadAddr || videoDetail.video?.playAddr?.replace(/\\u002F/g, '/') || '',
      thumbnailUrl: videoDetail.video?.cover || videoDetail.video?.originCover || '',
      width: videoDetail.video?.width || 576,
      height: videoDetail.video?.height || 1024,
    };
  } catch (e) {
    console.error('Failed to fetch from TikTok page:', e);
    return null;
  }
}

async function fetchFromOembed(tiktokUrl: string): Promise<TikTokVideoData | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(tiktokUrl)}`
    );
    const data = await res.json();

    return {
      title: data.title || 'TikTok Video',
      author: data.author_name || 'Unknown',
      videoUrl: '',  // oEmbed doesn't provide direct .mp4
      thumbnailUrl: data.thumbnail_url || '',
      width: data.thumbnail_width || 576,
      height: data.thumbnail_height || 1024,
    };
  } catch (e) {
    console.error('Failed to fetch from oEmbed:', e);
    return null;
  }
}
```

### 3. Important OG Tag Notes for iMessage

iMessage's link preview crawler (Apple's bot) looks for specific meta tags. For inline video playback, you need:

```html
<meta property="og:type" content="video.other" />
<meta property="og:video" content="https://direct-link-to.mp4" />
<meta property="og:video:type" content="video/mp4" />
<meta property="og:video:width" content="576" />
<meta property="og:video:height" content="1024" />
<meta property="og:image" content="https://thumbnail-url.jpg" />
<meta property="og:title" content="Video Title" />
```

Key requirements:
- `og:video` MUST be a direct `.mp4` URL, not an iframe or embed page
- `og:video:type` MUST be `video/mp4`
- `og:image` should be set as fallback thumbnail
- The page must respond quickly (Apple's crawler has a short timeout)
- The meta tags must be in the initial HTML (no client-side rendering)

### 4. Caching Strategy

Since `downloadAddr` URLs expire, implement short caching:

```ts
// In next.config.ts or via fetch options
// Cache TikTok page fetches for 5 minutes max
// This balances performance with URL expiry

// Option A: Next.js fetch cache
fetch(tiktokUrl, { next: { revalidate: 300 } });

// Option B: In-memory cache (for edge runtime)
const cache = new Map<string, { data: TikTokVideoData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

## iOS Shortcut Setup

Create a Shortcut that:

1. **Accepts:** URLs from the Share Sheet
2. **Action 1:** Get `URL` from shortcut input
3. **Action 2:** Replace Text — find `tiktok.com` replace with `yourdomain.com`
4. **Also handle:** `vt.tiktok.com` and `vm.tiktok.com` (short URL variants)
5. **Action 3:** Copy to Clipboard (or open Share Sheet with new URL)

### Handling Short URLs (vt.tiktok.com, vm.tiktok.com)

Short TikTok URLs like `vt.tiktok.com/ZMkABC123/` redirect to the full `tiktok.com/@user/video/123` URL. Your server needs to handle this:

**Option A — Resolve in the Shortcut:**
Add a "Get Contents of URL" step that follows the redirect, then do the domain swap on the resolved URL.

**Option B — Resolve on the server:**
Add a route or middleware that, if the path doesn't match `/@user/video/ID`, tries fetching `https://vt.tiktok.com/<path>` and follows redirects to get the canonical URL, then processes that.

Option A is simpler and recommended.

## Deployment

```bash
# Create project
npx create-next-app@latest tiktok-embed --typescript --app --tailwind

# Install dependencies (none beyond Next.js needed)

# Deploy to Vercel
vercel

# Set up custom domain in Vercel dashboard
# e.g., tiktokview.yourdomain.com or tikview.com
```

## Testing Checklist

1. **Server response:** Visit `yourdomain.com/@itsitorri/video/7550389730706345271` in a browser — video should play
2. **OG tags:** Use https://www.opengraph.xyz/ or Facebook's Sharing Debugger to verify meta tags render correctly
3. **iMessage preview:** Send the URL to yourself in iMessage and check if the video preview appears
4. **Short URLs:** Test with a `vt.tiktok.com` link through the shortcut flow
5. **Expiry handling:** Wait 30+ minutes and re-test to make sure fresh URLs are being fetched

## Known Risks & Edge Cases

- **TikTok may block server-side fetches** — if they detect bot traffic, you may need to rotate User-Agent strings or add request delays
- **`downloadAddr` URL structure may change** — the JSON path in `__UNIVERSAL_DATA_FOR_REHYDRATION__` is not a public API and could break
- **Private/deleted videos** — handle gracefully with a fallback message
- **iMessage may not always play inline** — Apple's behavior with `og:video` can be inconsistent; worst case, it shows a thumbnail with a tap-to-open link, which is still better than a raw TikTok link
- **Rate limiting** — if you share many links, TikTok may rate-limit your server's IP. Consider adding retry logic
- **TikTok ToS** — this proxies their content; keep it personal-use only