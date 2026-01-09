import { z } from 'zod';

export const listMatchesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const matchIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createMatchSchema = z.object({
  sport: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  status: z.string().min(1),
  startTime: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'startTime must be a valid ISO date string',
    }),
  homeScore: z.coerce.number().int().nonnegative().optional(),
  awayScore: z.coerce.number().int().nonnegative().optional(),
});

export const updateScoreSchema = z.object({
  homeScore: z.coerce.number().int().nonnegative(),
  awayScore: z.coerce.number().int().nonnegative(),
});
