import { WebSocket, WebSocketServer } from "ws";
import { eq } from "drizzle-orm";
import { db } from "../db/db.js";
import { matches } from "../db/schema.js";
import { MAX_SUBSCRIPTIONS, wsMessageSchema } from "../validation/ws.js";

const HEARTBEAT_MS = 30_000;
const MAX_BUFFERED_BYTES = 1_000_000;
const MAX_MATCH_CACHE = 10_000;
const MATCH_CACHE_TTL_MS = 10_000;

const matchSubscribers = new Map();
const matchExistsCache = new Map();

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1013, "Backpressure");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function replyError(socket, code, message, extra) {
  sendJson(socket, {
    type: "error",
    code,
    message,
    ...extra,
  });
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

function cleanupSubscriptions(socket) {
  for (const id of socket.subscriptions) {
    unsubscribe(id, socket);
  }
}

function pruneMatchCache(now) {
  for (const [key, value] of matchExistsCache) {
    if (value.expiresAt <= now) {
      matchExistsCache.delete(key);
    }
  }
}

async function matchExists(matchId) {
  const now = Date.now();
  const cached = matchExistsCache.get(matchId);
  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }
  if (matchExistsCache.size > MAX_MATCH_CACHE) {
    pruneMatchCache(now);
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

async function handleSubscribe(socket, matchId) {
  if (
    !socket.subscriptions.has(matchId) &&
    socket.subscriptions.size >= MAX_SUBSCRIPTIONS
  ) {
    replyError(
      socket,
      "too_many_subscriptions",
      `Max subscriptions is ${MAX_SUBSCRIPTIONS}`,
    );
    return;
  }

  let exists;
  try {
    exists = await matchExists(matchId);
  } catch {
    replyError(socket, "match_lookup_failed", "Unable to validate match");
    return;
  }

  if (!exists) {
    replyError(socket, "match_not_found", `Match ${matchId} not found`);
    return;
  }

  subscribe(matchId, socket);
  socket.subscriptions.add(matchId);
  sendJson(socket, { type: "subscribed", matchId });
}

function handleUnsubscribe(socket, matchId) {
  unsubscribe(matchId, socket);
  socket.subscriptions.delete(matchId);
  sendJson(socket, { type: "unsubscribed", matchId });
}

async function handleSetSubscriptions(socket, matchIds) {
  const deduped = Array.from(new Set(matchIds));
  if (deduped.length > MAX_SUBSCRIPTIONS) {
    replyError(
      socket,
      "too_many_subscriptions",
      `Max subscriptions is ${MAX_SUBSCRIPTIONS}`,
    );
    return;
  }

  let missing = [];
  try {
    const checks = await Promise.all(
      deduped.map(async (id) => [id, await matchExists(id)]),
    );
    missing = checks.filter(([, ok]) => !ok).map(([id]) => id);
  } catch {
    replyError(socket, "match_lookup_failed", "Unable to validate matches");
    return;
  }

  if (missing.length > 0) {
    replyError(socket, "match_not_found", "One or more matches not found", {
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
  sendJson(socket, { type: "subscriptions", matchIds: deduped });
}

function broadcastToMatch(matchId, payload) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const message = JSON.stringify(payload);
  for (const client of subscribers) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }
    if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
      client.close(1013, "Backpressure");
      continue;
    }
    client.send(message);
  }
}

function getMatchIdFromRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const matchId = Number(url.searchParams.get("matchId"));
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

function handleMessage(socket, data) {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    replyError(socket, "invalid_json", "Message must be valid JSON");
    return;
  }

  const parsed = wsMessageSchema.safeParse(message);
  if (!parsed.success) {
    replyError(socket, "invalid_message", "Message schema invalid", {
      details: parsed.error.flatten(),
    });
    return;
  }

  switch (parsed.data.type) {
    case "subscribe":
      void handleSubscribe(socket, parsed.data.matchId);
      break;
    case "unsubscribe":
      handleUnsubscribe(socket, parsed.data.matchId);
      break;
    case "setSubscriptions":
      void handleSetSubscriptions(socket, parsed.data.matchIds);
      break;
    case "ping":
      sendJson(socket, { type: "pong" });
      break;
    default:
      break;
  }
}

function handleConnection(socket, req) {
  socket.isAlive = true;
  socket.subscriptions = new Set();

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  const matchId = getMatchIdFromRequest(req);
  if (matchId) {
    void handleSubscribe(socket, matchId);
  }

  sendJson(socket, { type: "welcome" });

  socket.on("message", (data) => {
    handleMessage(socket, data);
  });

  socket.on("error", () => {
    socket.terminate();
  });

  socket.on("close", () => {
    cleanupSubscriptions(socket);
  });
}

export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  });

  wss.on("connection", handleConnection);

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

  function broadcastCommentary(matchId, comment) {
    broadcastToMatch(matchId, { type: "commentary", data: comment });
  }

  function broadcastScoreUpdate(matchId, score) {
    broadcastToMatch(matchId, { type: "score_update", matchId, data: score });
  }

  return { broadcastCommentary, broadcastScoreUpdate };
}
