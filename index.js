import 'dotenv/config';
import http from 'http';
import express from 'express';
import { createMatchRouter } from './src/routes/matches.js';
import { createWebSocketServer } from './src/ws/server.js';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json());
app.get('/', (req, res) => {
  res.send('Sports Commentary API');
});

const server = http.createServer(app);
const { broadcastCommentary, broadcastScoreUpdate } = createWebSocketServer(server);

app.use('/matches', createMatchRouter({ broadcastCommentary, broadcastScoreUpdate }));

server.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server running on ${baseUrl}`);
  console.log(`WebSocket running on ${baseUrl.replace('http', 'ws')}/ws`);
});
