import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

export interface YouTubeVideoResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  publishedAt: string;
  description: string;
}

export async function GET(req: NextRequest) {
  await requireSession();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  if (!YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: 'YOUTUBE_API_KEY not configured', results: [] },
      { status: 200 },
    );
  }

  const url = new URL(YT_SEARCH_URL);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', `${q} recipe healthy`);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoCategoryId', '26'); // How-to & Style
  url.searchParams.set('maxResults', '9');
  url.searchParams.set('relevanceLanguage', 'en');
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('key', YOUTUBE_API_KEY);

  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) {
    const err = await res.text();
    console.error('[nutrition/recipes] YouTube API error', res.status, err);
    return NextResponse.json({ error: 'YouTube API error' }, { status: 502 });
  }

  const data = await res.json();
  const results: YouTubeVideoResult[] = (data.items ?? []).map(
    (item: {
      id: { videoId: string };
      snippet: {
        title: string;
        channelTitle: string;
        thumbnails: { medium: { url: string }; default: { url: string } };
        publishedAt: string;
        description: string;
      };
    }) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      thumbnail:
        item.snippet.thumbnails.medium?.url ??
        item.snippet.thumbnails.default?.url ??
        '',
      publishedAt: item.snippet.publishedAt,
      description: item.snippet.description,
    }),
  );

  return NextResponse.json({ results });
}
