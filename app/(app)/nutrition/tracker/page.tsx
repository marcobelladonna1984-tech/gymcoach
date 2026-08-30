import { Apple } from 'lucide-react';
import { requireSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { NutritionTrackerClient } from '@/components/nutrition/nutrition-tracker-client';
import { NutritionSummaryCard } from '@/components/nutrition/nutrition-summary-card';
import { EmptyState } from '@/components/ui/empty-state';

const DAYS_WINDOW = 7;

export default async function NutritionTrackerPage() {
  const auth = await requireSession();

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - DAYS_WINDOW);

  const [entries, target] = await Promise.all([
    db.nutritionEntry.findMany({
      where: { userId: auth.userId, loggedAt: { gte: since } },
      orderBy: { loggedAt: 'desc' },
      select: {
        id: true,
        name: true,
        kcal: true,
        proteinG: true,
        carbsG: true,
        fatG: true,
        meal: true,
        loggedAt: true,
        note: true,
      },
    }),
    db.nutritionTarget.findUnique({ where: { userId: auth.userId } }),
  ]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayEntries = entries.filter(
    (e) => e.loggedAt.toISOString().slice(0, 10) === todayKey,
  );

  const todayTotals = todayEntries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  return (
    <main className="flex-1 px-4 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Apple className="size-6" />
          <h1 className="text-2xl font-bold tracking-tight">Nutrition Tracker</h1>
        </div>

        <NutritionSummaryCard
          totals={todayTotals}
          target={
            target
              ? {
                  kcal: target.kcal,
                  proteinG: target.proteinG,
                  carbsG: target.carbsG,
                  fatG: target.fatG,
                }
              : null
          }
        />

        {entries.length === 0 ? (
          <EmptyState
            icon={Apple}
            title="No food logged yet"
            description="Log your first meal to start tracking your macros."
          />
        ) : (
          <NutritionTrackerClient
            entries={entries.map((e) => ({
              id: e.id,
              name: e.name,
              kcal: e.kcal,
              proteinG: e.proteinG,
              carbsG: e.carbsG,
              fatG: e.fatG,
              meal: e.meal,
              loggedAt: e.loggedAt.toISOString(),
              note: e.note ?? null,
            }))}
          />
        )}
      </div>
    </main>
  );
}
