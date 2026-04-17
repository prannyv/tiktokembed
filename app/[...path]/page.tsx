import { Metadata } from 'next';
import { getTikTokVideoData, isCanonicalPath, resolveShortUrl } from '@/lib/tiktok';

// Let Next.js ISR handle caching — the page is generated once and served
// from the edge CDN. The tikwm fetch uses revalidate: 600, so after 10 min
// the next request triggers a background regeneration. The /api/warm route
// can prime the cache ahead of time.

type Props = {
  params: Promise<{ path: string[] }>;
};

async function buildTikTokUrl(path: string[]): Promise<string> {
  if (isCanonicalPath(path)) {
    return `https://www.tiktok.com/${path.join('/')}`;
  }

  const resolved = await resolveShortUrl(path.join('/'));
  if (resolved) return resolved;

  return `https://www.tiktok.com/${path.join('/')}`;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://tiktokembed.vercel.app';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { path } = await params;
  const tiktokUrl = await buildTikTokUrl(path);

  try {
    const data = await getTikTokVideoData(tiktokUrl);

    // Point og:video at our proxy so iMessage's HEAD request succeeds
    // (TikTok CDN returns 504 on HEAD, breaking auto-play)
    const proxyVideoUrl = `${SITE_URL}/api/video/${data.id}`;

    const ogVideos = data.videoUrl
      ? [
          {
            url: proxyVideoUrl,
            secureUrl: proxyVideoUrl,
            type: 'video/mp4' as const,
            width: data.width,
            height: data.height,
          },
        ]
      : undefined;

    return {
      title: data.title,
      openGraph: {
        title: data.title,
        description: `${data.author} on TikTok`,
        type: 'video.other',
        siteName: 'TikTok Embed',
        videos: ogVideos,
        images: data.thumbnailUrl ? [{ url: data.thumbnailUrl }] : undefined,
      },
      twitter: {
        card: 'player',
        title: data.title,
        description: `${data.author} on TikTok`,
        images: data.thumbnailUrl ? [data.thumbnailUrl] : undefined,
      },
    };
  } catch {
    return {
      title: 'TikTok Video',
      description: 'Could not load this video.',
    };
  }
}

export default async function TikTokPage({ params }: Props) {
  const { path } = await params;
  const tiktokUrl = await buildTikTokUrl(path);

  let data;
  let error: string | null = null;

  try {
    data = await getTikTokVideoData(tiktokUrl);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error';
  }

  if (error || !data) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen px-6 py-12 text-center">
        <div className="max-w-sm w-full space-y-4">
          <p className="text-gray-400 text-lg">Could not load this video.</p>
          <a
            href={tiktokUrl}
            className="inline-block text-pink-400 hover:text-pink-300 underline transition-colors"
          >
            Open on TikTok →
          </a>
        </div>
      </main>
    );
  }

  // Browser visitors get the direct TikTok CDN URL (works for GET requests)
  // The proxy URL is only needed in og:video tags for crawler HEAD requests
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        {data.videoUrl ? (
          <video
            src={data.hdVideoUrl || data.videoUrl}
            poster={data.thumbnailUrl || undefined}
            controls
            autoPlay
            muted
            playsInline
            loop
            className="w-full rounded-2xl shadow-2xl shadow-black/60"
            style={{ maxHeight: '80vh', objectFit: 'contain' }}
          />
        ) : data.thumbnailUrl ? (
          <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.thumbnailUrl}
              alt={data.title}
              className="w-full"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <a
                href={tiktokUrl}
                className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white transition-colors"
                aria-label="Open on TikTok"
              >
                <svg
                  className="w-7 h-7 text-black ml-1"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </a>
            </div>
          </div>
        ) : null}

        <div className="space-y-1 px-1">
          <p className="font-semibold text-white leading-snug line-clamp-2">
            {data.title}
          </p>
          <p className="text-sm text-gray-400">{data.author}</p>
        </div>

        <a
          href={tiktokUrl}
          className="block w-full text-center py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm text-gray-300 transition-colors"
        >
          View on TikTok →
        </a>
      </div>
    </main>
  );
}
