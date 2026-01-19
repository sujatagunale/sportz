import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import { matchRouter } from "./routes/matches.js";
import { commentaryRouter } from "./routes/commentary.js";
import { createWebSocketServer } from "./ws/server.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

app.use(express.json());
app.use(cors());
app.get("/", (req, res) => {
  res.send("Sports Commentary API");
});

const server = http.createServer(app);
const { broadcastCommentary, broadcastScoreUpdate } =
  createWebSocketServer(server);

app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastScoreUpdate = broadcastScoreUpdate;

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

server.listen(PORT, HOST, () => {
  const baseUrl =
    HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

  console.log(`Server running on ${baseUrl}`);
  console.log(`WebSocket running on ${baseUrl.replace("http", "ws")}/ws`);
});
