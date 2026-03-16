import http from 'http';
import type { Socket } from 'net';
import { logger } from '../utils/logger.js';

interface RouteHandler {
  (body: any): Promise<any>;
}

let server: http.Server | null = null;
let apiToken: string = '';
const routes = new Map<string, RouteHandler>();
const activeSockets = new Set<Socket>();

export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function getApiToken(): string {
  return apiToken;
}

export function getApiPort(): number {
  return 19816;
}

export async function startInternalApi(token: string): Promise<void> {
  apiToken = token;

  server = http.createServer(async (req, res) => {
    // CORS and security
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Token validation
    const reqToken = req.headers['x-telaude-token'] as string;
    if (reqToken !== apiToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Only POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const url = req.url ?? '';
    const handler = routes.get(url);
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Parse body
    let body: any = {};
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (raw) {
        body = JSON.parse(raw);
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Inject userId from header into body for route handlers
    const userIdHeader = req.headers['x-telaude-user-id'] as string;
    if (userIdHeader) {
      body._userId = parseInt(userIdHeader, 10);
    }

    try {
      const result = await handler(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result ?? { ok: true }));
    } catch (err: any) {
      logger.error({ err, url }, 'Internal API handler error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message ?? 'Internal error' }));
    }
  });

  // Track active connections for forced cleanup on stop
  server.on('connection', (socket: Socket) => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
  });

  return new Promise<void>((resolve, reject) => {
    server!.listen({ port: 19816, host: '127.0.0.1', exclusive: true }, () => {
      logger.info({ port: 19816 }, 'Internal API server started');
      resolve();
    });
    server!.on('error', reject);
  });
}

export async function stopInternalApi(): Promise<void> {
  if (!server) return;
  // Destroy all active sockets so server.close() resolves immediately
  for (const socket of activeSockets) {
    socket.destroy();
  }
  activeSockets.clear();
  return new Promise<void>((resolve) => {
    server!.close(() => {
      logger.info('Internal API server stopped');
      server = null;
      resolve();
    });
    // Safety net: force resolve after 1s
    setTimeout(() => {
      if (server) {
        logger.warn('Internal API server close timed out, forcing');
        server = null;
        resolve();
      }
    }, 1000);
  });
}
