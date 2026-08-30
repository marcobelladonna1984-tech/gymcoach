import { Apple, BookOpen, UtensilsCrossed } from 'lucide-react';
import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function NutritionPage() {
  await requireSession();
  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Apple className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">Nutrition</h1>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link href="/nutrition/tracker">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UtensilsCrossed className="size-5" />
                  Macro Tracker
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Log meals, track kcal, protein, carbs and fat against your daily targets.
                </p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/nutrition/recipes">
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="size-5" />
                  Recipe Videos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Search healthy recipe videos on YouTube filtered by your goals.
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </main>
  );
}
