import { Youtube } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { RecipeSearchClient } from '@/components/nutrition/recipe-search-client';

export default async function RecipesPage() {
  await requireSession();

  const hasYoutubeKey = Boolean(process.env.YOUTUBE_API_KEY);

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Youtube className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">Recipe Videos</h1>
        </div>

        {!hasYoutubeKey && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
            Add <code className="font-mono">YOUTUBE_API_KEY</code> to your{' '}
            <code className="font-mono">.env</code> to enable recipe video search.{' '}
            Get a free key at{' '}
            <a
              href="https://console.developers.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              console.developers.google.com
            </a>{' '}
            (YouTube Data API v3, 10,000 free queries/day).
          </div>
        )}

        <RecipeSearchClient />
      </div>
    </main>
  );
}
