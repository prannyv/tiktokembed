import { redirect } from 'next/navigation';
import { fallbackMetadata, parseEmbedMetadata } from '@/lib/embed-metadata';
import { getTikTokVideoData } from '@/lib/tiktok';

type Props = {
  params: Promise<{ path: string[] }>;
};

type Platform = 'instagram' | 'tiktok';

export default async function ViewerPage({ params }: Props) {
  const { path } = await params;
  const platform = detectPlatform(path);
  const videoId = extractVideoIdFromPath(path, platform);
  const originalUrl = buildOriginalUrl(path, platform);
  const cachedVideoUrl = await getCachedVideoUrl(videoId);
  const cachedMetadata = await getCachedMetadata(videoId, platform);

  if (platform === 'instagram') {
    if (!cachedVideoUrl) redirect(originalUrl);

    return (
      <VideoView
        videoUrl={cachedVideoUrl}
        title={cachedMetadata.title}
        author={cachedMetadata.author}
        originalUrl={originalUrl}
        originalLabel="View on Instagram →"
      />
    );
  }

  let title = 'TikTok Video';
  let author = 'TikTok';
  let poster = '';
  let fallbackVideoUrl = '';

  try {
    const data = await getTikTokVideoData(originalUrl);
    title = data.title;
    author = data.author;
    poster = data.thumbnailUrl;
    fallbackVideoUrl = data.hdVideoUrl || data.videoUrl;
  } catch {
    if (!cachedVideoUrl) redirect(originalUrl);
  }

  return (
    <VideoView
      videoUrl={cachedVideoUrl ?? fallbackVideoUrl}
      poster={poster}
      title={title}
      author={author}
      originalUrl={originalUrl}
      originalLabel="View on TikTok →"
    />
  );
}

function VideoView({
  videoUrl,
  poster,
  title,
  author,
  originalUrl,
  originalLabel,
}: {
  videoUrl: string;
  poster?: string;
  title: string;
  author: string;
  originalUrl: string;
  originalLabel: string;
}) {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <video
          src={videoUrl}
          poster={poster || undefined}
          controls
          autoPlay
          muted
          playsInline
          loop
          className="w-full rounded-2xl shadow-2xl shadow-black/60"
          style={{ maxHeight: '80vh', objectFit: 'contain' }}
        />

        <div className="space-y-1 px-1">
          <p className="font-semibold text-white leading-snug line-clamp-2">{title}</p>
          <p className="text-sm text-gray-400">{author}</p>
        </div>

        <a
          href={originalUrl}
          className="block w-full text-center py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm text-gray-300 transition-colors"
        >
          {originalLabel}
        </a>
      </div>
    </main>
  );
}

function detectPlatform(path: string[]): Platform {
  return path[0] === 'reel' || path.includes('reel') ? 'instagram' : 'tiktok';
}

function extractVideoIdFromPath(path: string[], platform: Platform): string {
  const joinedPath = `/${path.join('/')}`;
  const match =
    platform === 'instagram'
      ? joinedPath.match(/\/reel\/([A-Za-z0-9_-]+)/)
      : joinedPath.match(/\/video\/(\d{15,25})/);

  return match?.[1] ?? '';
}

function buildOriginalUrl(path: string[], platform: Platform): string {
  const joinedPath = path.join('/');
  const host = platform === 'instagram' ? 'www.instagram.com' : 'www.tiktok.com';
  return `https://${host}/${joinedPath}`;
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

async function getCachedMetadata(videoId: string, platform: Platform): Promise<{ title: string; author: string }> {
  if (!videoId) return fallbackMetadata(platform);

  const accountId = process.env.CF_ACCOUNT_ID;
  const namespace = process.env.CF_KV_NAMESPACE;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !namespace || !token) return fallbackMetadata(platform);

  try {
    const key = `metadata:${videoId}`;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`,
      {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) return fallbackMetadata(platform);

    return parseEmbedMetadata(await res.text()) ?? fallbackMetadata(platform);
  } catch {
    return fallbackMetadata(platform);
  }
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
