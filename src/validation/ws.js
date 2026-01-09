import { z } from 'zod';

export const MAX_SUBSCRIPTIONS = 50;

const matchIdSchema = z.coerce.number().int().positive();

export const wsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    matchId: matchIdSchema,
  }),
  z.object({
    type: z.literal('unsubscribe'),
    matchId: matchIdSchema,
  }),
  z.object({
    type: z.literal('setSubscriptions'),
    matchIds: z.array(matchIdSchema).max(MAX_SUBSCRIPTIONS),
  }),
  z.object({
    type: z.literal('ping'),
  }),
]);
