import { z } from 'zod';

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const createCommentarySchema = z.object({
  minute: z.coerce.number().int().nonnegative().optional(),
  sequence: z.coerce.number().int().nonnegative().optional(),
  period: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  message: z.string().min(1),
  metadata: z.unknown().optional(),
  tags: z.array(z.string().min(1)).optional(),
});
