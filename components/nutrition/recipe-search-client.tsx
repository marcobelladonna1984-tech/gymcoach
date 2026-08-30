'use client';

import { useState, useTransition } from 'react';
import { Search, ExternalLink, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import type { YouTubeVideoResult } from '@/app/api/nutrition/recipes/route';

const QUICK_SEARCHES = [
  'high protein chicken',
  'low carb dinner',
  'post workout meal',
  'meal prep lunch',
  'healthy breakfast',
  'protein smoothie',
];

export function RecipeSearchClient() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeVideoResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function search(q: string) {
    if (!q.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/nutrition/recipes?q=${encodeURIComponent(q)}`,
      );
      const data = await res.json();
      if (data.error && !data.results) {
        setError(data.error);
        setResults([]);
      } else {
        setResults(data.results ?? []);
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    search(query);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Search bar */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder="Search recipes (e.g. high protein pasta)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={isPending}>
          <Search className="size-4" />
        </Button>
      </form>

      {/* Quick search chips */}
      <div className="flex flex-wrap gap-2">
        {QUICK_SEARCHES.map((q) => (
          <button
            key={q}
            onClick={() => { setQuery(q); search(q); }}
            className="rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-secondary"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Loading skeleton */}
      {isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-52 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {/* Results grid */}
      {!isPending && results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((v) => (
            <Card key={v.videoId} className="overflow-hidden">
              <a
                href={`https://www.youtube.com/watch?v=${v.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.thumbnail}
                    alt={v.title}
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="size-10 fill-white text-white drop-shadow" />
                  </div>
                </div>
              </a>
              <CardContent className="p-3">
                <p className="line-clamp-2 text-sm font-medium leading-snug">
                  {v.title}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {v.channelTitle}
                  </span>
                  <a
                    href={`https://www.youtube.com/watch?v=${v.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state after search */}
      {!isPending && results.length === 0 && query && !error && (
        <p className="text-center text-sm text-muted-foreground">
          No results found for &ldquo;{query}&rdquo;. Try different keywords.
        </p>
      )}
    </div>
  );
}
