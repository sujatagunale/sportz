import { WebSocketServer } from 'ws';

const HEARTBEAT_MS = 30000;
const MAX_BUFFERED_BYTES = 1_000_000;

export function createWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  });
  const matchSubscribers = new Map();

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

  function broadcastCommentary(matchId, comment) {
    const subscribers = matchSubscribers.get(matchId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = JSON.stringify({ type: 'commentary', data: comment });

    for (const client of subscribers) {
      if (client.readyState !== 1) {
        continue;
      }
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        continue;
      }
      client.send(payload);
    }
  }

  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    socket.subscriptions = new Set();
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const matchId = Number(url.searchParams.get('matchId'));
    if (Number.isInteger(matchId)) {
      subscribe(matchId, socket);
      socket.subscriptions.add(matchId);
    }

    socket.send(JSON.stringify({ type: 'welcome' }));

    socket.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (message.type === 'subscribe' && Number.isInteger(message.matchId)) {
        subscribe(message.matchId, socket);
        socket.subscriptions.add(message.matchId);
        socket.send(
          JSON.stringify({ type: 'subscribed', matchId: message.matchId })
        );
        return;
      }

      if (message.type === 'unsubscribe' && Number.isInteger(message.matchId)) {
        unsubscribe(message.matchId, socket);
        socket.subscriptions.delete(message.matchId);
        socket.send(
          JSON.stringify({ type: 'unsubscribed', matchId: message.matchId })
        );
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

  return { broadcastCommentary };
}
