'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface Props {
  totals: Macros;
  target: Macros | null;
}

function MacroBar({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: string;
  color: string;
}) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {Math.round(value)}{unit}{target ? ` / ${target}${unit}` : ''}
        </span>
      </div>
      {pct !== null && (
        <Progress value={pct} className={`h-2 ${color}`} />
      )}
    </div>
  );
}

export function NutritionSummaryCard({ totals, target }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Today&apos;s Macros</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MacroBar label="Calories" value={totals.kcal} target={target?.kcal ?? null} unit=" kcal" color="" />
        <MacroBar label="Protein" value={totals.proteinG} target={target?.proteinG ?? null} unit="g" color="[&>div]:bg-blue-500" />
        <MacroBar label="Carbs" value={totals.carbsG} target={target?.carbsG ?? null} unit="g" color="[&>div]:bg-yellow-500" />
        <MacroBar label="Fat" value={totals.fatG} target={target?.fatG ?? null} unit="g" color="[&>div]:bg-orange-500" />
      </CardContent>
    </Card>
  );
}
