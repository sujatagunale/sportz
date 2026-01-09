import http from 'http';
import express from 'express';
import { createMatchRouter } from './routes/matches.js';
import { createWebSocketServer } from './ws/server.js';

const app = express();
const PORT = 3000;

app.use(express.json());
app.get('/', (req, res) => {
  res.send('Sports Commentary API');
});

const server = http.createServer(app);
const { broadcastCommentary, broadcastScoreUpdate } = createWebSocketServer(server);

app.use('/matches', createMatchRouter({ broadcastCommentary, broadcastScoreUpdate }));

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket running on ws://localhost:${PORT}/ws`);
});
