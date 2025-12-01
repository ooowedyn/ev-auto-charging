// backend/server.js
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { initWebSocket } from './sockets/wsHandler.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
initWebSocket(server);

const PORT = process.env.PORT || 3101;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
