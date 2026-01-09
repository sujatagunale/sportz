import { WebSocket, WebSocketServer } from 'ws';
import { eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { matches } from '../db/schema.js';
import {
  MAX_SUBSCRIPTIONS,
  wsMessageSchema,
} from '../validation/ws.js';

const HEARTBEAT_MS = 30000;
const MAX_BUFFERED_BYTES = 1_000_000;
const MATCH_CACHE_TTL_MS = 10000;
const RATE_LIMIT_CAPACITY = 20;
const RATE_LIMIT_REFILL_PER_SEC = 10;

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  });
  const matchSubscribers = new Map();
  const matchExistsCache = new Map();

  function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.close(1013, 'Backpressure');
      return false;
    }
    socket.send(JSON.stringify(payload));
    return true;
  }

  function subscribe(matchId, socket) {
    if (!matchSubscribers.has(matchId)) {
      matchSubscribers.set(matchId, new Set());
    }
    matchSubscribers.get(matchId).add(socket);
  }

  function unsubscribe(matchId, socket) {
    const set = matchSubscribers.get(matchId);
    if (!set) {
      return;
    }
    set.delete(socket);
    if (set.size === 0) {
      matchSubscribers.delete(matchId);
    }
  }

  async function matchExists(matchId) {
    const now = Date.now();
    const cached = matchExistsCache.get(matchId);
    if (cached && cached.expiresAt > now) {
      return cached.exists;
    }
    if (matchExistsCache.size > 10000) {
      for (const [key, value] of matchExistsCache) {
        if (value.expiresAt <= now) {
          matchExistsCache.delete(key);
        }
      }
    }

    const [row] = await db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);
    const exists = Boolean(row);

    matchExistsCache.set(matchId, {
      exists,
      expiresAt: now + MATCH_CACHE_TTL_MS,
    });
    return exists;
  }

  function rateLimitOk(socket) {
    const now = Date.now();
    const elapsedSec = (now - socket.rateLimit.lastRefill) / 1000;
    socket.rateLimit.tokens = Math.min(
      RATE_LIMIT_CAPACITY,
      socket.rateLimit.tokens + elapsedSec * RATE_LIMIT_REFILL_PER_SEC
    );
    socket.rateLimit.lastRefill = now;

    if (socket.rateLimit.tokens < 1) {
      return false;
    }
    socket.rateLimit.tokens -= 1;
    return true;
  }

  async function handleSubscribe(socket, matchId) {
    if (
      !socket.subscriptions.has(matchId) &&
      socket.subscriptions.size >= MAX_SUBSCRIPTIONS
    ) {
      sendJson(socket, {
        type: 'error',
        code: 'too_many_subscriptions',
        message: `Max subscriptions is ${MAX_SUBSCRIPTIONS}`,
      });
      return;
    }

    let exists;
    try {
      exists = await matchExists(matchId);
    } catch {
      sendJson(socket, {
        type: 'error',
        code: 'match_lookup_failed',
        message: 'Unable to validate match',
      });
      return;
    }

    if (!exists) {
      sendJson(socket, {
        type: 'error',
        code: 'match_not_found',
        message: `Match ${matchId} not found`,
      });
      return;
    }

    subscribe(matchId, socket);
    socket.subscriptions.add(matchId);
    sendJson(socket, { type: 'subscribed', matchId });
  }

  function handleUnsubscribe(socket, matchId) {
    unsubscribe(matchId, socket);
    socket.subscriptions.delete(matchId);
    sendJson(socket, { type: 'unsubscribed', matchId });
  }

  async function handleSetSubscriptions(socket, matchIds) {
    const deduped = Array.from(new Set(matchIds));
    if (deduped.length > MAX_SUBSCRIPTIONS) {
      sendJson(socket, {
        type: 'error',
        code: 'too_many_subscriptions',
        message: `Max subscriptions is ${MAX_SUBSCRIPTIONS}`,
      });
      return;
    }

    let missing = [];
    try {
      const checks = await Promise.all(
        deduped.map(async (id) => [id, await matchExists(id)])
      );
      missing = checks.filter(([, ok]) => !ok).map(([id]) => id);
    } catch {
      sendJson(socket, {
        type: 'error',
        code: 'match_lookup_failed',
        message: 'Unable to validate matches',
      });
      return;
    }

    if (missing.length > 0) {
      sendJson(socket, {
        type: 'error',
        code: 'match_not_found',
        message: 'One or more matches not found',
        matchIds: missing,
      });
      return;
    }

    const nextSet = new Set(deduped);
    for (const id of socket.subscriptions) {
      if (!nextSet.has(id)) {
        unsubscribe(id, socket);
      }
    }
    for (const id of nextSet) {
      if (!socket.subscriptions.has(id)) {
        subscribe(id, socket);
      }
    }

    socket.subscriptions = nextSet;
    sendJson(socket, { type: 'subscriptions', matchIds: deduped });
  }

  function broadcastCommentary(matchId, comment) {
    const subscribers = matchSubscribers.get(matchId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = JSON.stringify({ type: 'commentary', data: comment });

    for (const client of subscribers) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        client.close(1013, 'Backpressure');
        continue;
      }
      client.send(payload);
    }
  }

  function broadcastScoreUpdate(matchId, score) {
    const subscribers = matchSubscribers.get(matchId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      type: 'score_update',
      matchId,
      data: score,
    });

    for (const client of subscribers) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        client.close(1013, 'Backpressure');
        continue;
      }
      client.send(payload);
    }
  }

  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    socket.rateLimit = {
      tokens: RATE_LIMIT_CAPACITY,
      lastRefill: Date.now(),
    };
    socket.subscriptions = new Set();
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const matchId = Number(url.searchParams.get('matchId'));
    if (Number.isInteger(matchId) && matchId > 0) {
      void handleSubscribe(socket, matchId);
    }

    sendJson(socket, { type: 'welcome' });

    socket.on('message', (data) => {
      if (!rateLimitOk(socket)) {
        sendJson(socket, {
          type: 'error',
          code: 'rate_limited',
          message: 'Too many messages',
        });
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        sendJson(socket, {
          type: 'error',
          code: 'invalid_json',
          message: 'Message must be valid JSON',
        });
        return;
      }

      const parsed = wsMessageSchema.safeParse(message);
      if (!parsed.success) {
        sendJson(socket, {
          type: 'error',
          code: 'invalid_message',
          message: 'Message schema invalid',
          details: parsed.error.flatten(),
        });
        return;
      }

      if (parsed.data.type === 'subscribe') {
        void handleSubscribe(socket, parsed.data.matchId);
        return;
      }

      if (parsed.data.type === 'unsubscribe') {
        handleUnsubscribe(socket, parsed.data.matchId);
        return;
      }

      if (parsed.data.type === 'setSubscriptions') {
        void handleSetSubscriptions(socket, parsed.data.matchIds);
        return;
      }

      if (parsed.data.type === 'ping') {
        sendJson(socket, { type: 'pong' });
      }
    });

    socket.on('error', () => {
      socket.terminate();
    });

    socket.on('close', () => {
      for (const id of socket.subscriptions) {
        unsubscribe(id, socket);
      }
    });
  });

  const pingInterval = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  pingInterval.unref();

  return { broadcastCommentary, broadcastScoreUpdate };
}
