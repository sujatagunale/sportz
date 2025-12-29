import http from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';

const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('Hello Express!');
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'welcome' }));

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type === 'commentary') {
      const payload = JSON.stringify({
        type: 'commentary',
        data: message.data,
      });

      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket running on ws://localhost:${PORT}/ws`);
});
