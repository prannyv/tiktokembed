export type EmbedMetadata = {
  title: string;
  author: string;
};

type MetadataInput = {
  platform: 'instagram' | 'tiktok' | 'unknown';
  sourceUrl: string;
  filename?: string;
};

export function fallbackMetadata(platform: 'instagram' | 'tiktok' | 'unknown'): EmbedMetadata {
  if (platform === 'instagram') {
    return { title: 'Instagram Reel', author: 'Instagram' };
  }

  return { title: 'TikTok Video', author: 'TikTok' };
}

export async function buildEmbedMetadata(input: MetadataInput): Promise<EmbedMetadata> {
  const fallback = fallbackMetadata(input.platform);
  const pageMetadata = input.platform === 'instagram' ? await fetchInstagramMetadata(input.sourceUrl) : null;
  const filenameMetadata = parseFilenameMetadata(input.filename);

  return {
    title: firstNonEmpty(pageMetadata?.title, filenameMetadata?.title, fallback.title),
    author: firstNonEmpty(pageMetadata?.author, filenameMetadata?.author, fallback.author),
  };
}

export function parseEmbedMetadata(value: string): EmbedMetadata | null {
  try {
    const json = JSON.parse(value) as Partial<EmbedMetadata>;
    if (!json.title && !json.author) return null;

    return {
      title: firstNonEmpty(json.title, 'Instagram Reel'),
      author: firstNonEmpty(json.author, 'Instagram'),
    };
  } catch {
    return null;
  }
}

async function fetchInstagramMetadata(sourceUrl: string): Promise<Partial<EmbedMetadata> | null> {
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    });

    if (!res.ok) return null;

    const html = await res.text();
    const ogTitle = readMeta(html, 'og:title');
    const ogDescription = readMeta(html, 'og:description');
    const title = extractCaption(ogTitle) || extractCaption(ogDescription);
    const author = extractInstagramAuthor(ogDescription) || extractInstagramAuthor(ogTitle);

    return {
      title: title ? truncate(title, 90) : undefined,
      author: author ? truncate(author, 50) : undefined,
    };
  } catch {
    return null;
  }
}

function readMeta(html: string, property: string): string {
  const escaped = property.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i')
  );

  return decodeHtml(match?.[1] ?? '');
}

function extractCaption(value = ''): string {
  const quoteMatch = value.match(/[“"]([^”"]+)[”"]/);
  const caption = quoteMatch?.[1] ?? value.split('\n')[0] ?? '';
  return cleanText(caption);
}

function extractInstagramAuthor(value = ''): string {
  const dashMatch = value.match(/\s-\s([^:]+?)\s+on\s+/i);
  const onInstagramMatch = value.match(/^(.+?)\s+on Instagram/i);
  return cleanText(dashMatch?.[1] ?? onInstagramMatch?.[1] ?? '');
}

function parseFilenameMetadata(filename?: string): Partial<EmbedMetadata> | null {
  if (!filename) return null;

  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) return null;

  const byMatch = base.match(/^(.*?)\s+(?:by|from)\s+@?([A-Za-z0-9_.-]+)$/i);
  const dashMatch = base.match(/^@?([A-Za-z0-9_.-]+)\s+-\s+(.+)$/);

  if (byMatch) {
    return { title: truncate(cleanText(byMatch[1]), 90), author: truncate(cleanText(byMatch[2]), 50) };
  }

  if (dashMatch) {
    return { title: truncate(cleanText(dashMatch[2]), 90), author: truncate(cleanText(dashMatch[1]), 50) };
  }

  return { title: truncate(cleanText(base), 90) };
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value && value.trim())?.trim() ?? '';
}

function cleanText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}…` : value;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
