// backend/server.js
import express from 'express';
import http from 'http';
import cors from 'cors';
import { initWebSocket } from './sockets/wsHandler.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
initWebSocket(server);

server.listen(3000, () => console.log('🚀 Server running on http://localhost:3000'));
