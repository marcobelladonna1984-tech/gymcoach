import { z } from 'zod';
import { HEALTH_CSV_MAX_BYTES } from '@/lib/import/health-csv';

// Health CSV import request (personal wellness flow). The csv field carries
// the raw healed-export / "salute" spreadsheet text (untrusted): the size cap
// is enforced here AND on the content-length before parsing. Same
// preview/confirm modes as the other imports; weight is always kg.
export const healthImportInputSchema = z.object({
  csv: z.string().min(1).max(HEALTH_CSV_MAX_BYTES, 'File too large: the limit is 5 MB.'),
  mode: z.enum(['preview', 'confirm']),
});

export type HealthImportInput = z.infer<typeof healthImportInputSchema>;
