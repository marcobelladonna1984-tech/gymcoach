'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRouter } from 'next/navigation';

type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK' | 'PRE_WORKOUT' | 'POST_WORKOUT';

interface Entry {
  id: string;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  meal: MealSlot;
  loggedAt: string;
  note: string | null;
}

const MEAL_LABELS: Record<MealSlot, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  SNACK: 'Snack',
  PRE_WORKOUT: 'Pre-workout',
  POST_WORKOUT: 'Post-workout',
};

export function NutritionTrackerClient({ entries: initialEntries }: { entries: Entry[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [isPending, startTransition] = useTransition();

  const [form, setForm] = useState({
    name: '',
    kcal: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    meal: 'SNACK' as MealSlot,
    note: '',
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      kcal: Number(form.kcal),
      proteinG: Number(form.proteinG),
      carbsG: Number(form.carbsG),
      fatG: Number(form.fatG),
      meal: form.meal,
      note: form.note || undefined,
    };
    const res = await fetch('/api/nutrition/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setForm({ name: '', kcal: '', proteinG: '', carbsG: '', fatG: '', meal: 'SNACK', note: '' });
      startTransition(() => router.refresh());
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/nutrition/entries/${id}`, { method: 'DELETE' });
    setEntries((prev) => prev.filter((e) => e.id !== id));
    startTransition(() => router.refresh());
  }

  const grouped = entries.reduce<Record<string, Entry[]>>((acc, e) => {
    const day = e.loggedAt.slice(0, 10);
    (acc[day] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {/* Add entry form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Log Food</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3">
              <Label htmlFor="name">Food / Meal</Label>
              <Input
                id="name"
                placeholder="e.g. Chicken breast 150g"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="kcal">kcal</Label>
              <Input id="kcal" type="number" min={0} placeholder="250" value={form.kcal} onChange={(e) => setForm((f) => ({ ...f, kcal: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="proteinG">Protein (g)</Label>
              <Input id="proteinG" type="number" min={0} placeholder="30" value={form.proteinG} onChange={(e) => setForm((f) => ({ ...f, proteinG: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="carbsG">Carbs (g)</Label>
              <Input id="carbsG" type="number" min={0} placeholder="20" value={form.carbsG} onChange={(e) => setForm((f) => ({ ...f, carbsG: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="fatG">Fat (g)</Label>
              <Input id="fatG" type="number" min={0} placeholder="8" value={form.fatG} onChange={(e) => setForm((f) => ({ ...f, fatG: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="meal">Meal</Label>
              <Select value={form.meal} onValueChange={(v) => setForm((f) => ({ ...f, meal: v as MealSlot }))}>
                <SelectTrigger id="meal"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MEAL_LABELS) as MealSlot[]).map((m) => (
                    <SelectItem key={m} value={m}>{MEAL_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-3 flex justify-end">
              <Button type="submit" disabled={isPending}>Log</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Entries grouped by day */}
      {Object.entries(grouped)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([day, dayEntries]) => (
          <Card key={day}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                {new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {dayEntries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {MEAL_LABELS[e.meal]} · {e.kcal} kcal · P {Math.round(e.proteinG)}g · C {Math.round(e.carbsG)}g · F {Math.round(e.fatG)}g
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(e.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
