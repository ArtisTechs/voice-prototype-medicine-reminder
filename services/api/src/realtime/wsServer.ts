import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { userFromToken } from '../core/http';
import { getLogger } from '../core/logger';
import * as patientRepo from '../repositories/patients';
import { serve } from './hub';

const log = getLogger('ws');

/**
 * `GET /api/v1/ws?token=<access JWT>` (React Native cannot set WebSocket headers).
 * A bad token closes the socket with code 4401. Query strings are never logged.
 */
export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/api/v1/ws') {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token') ?? '';
    wss.handleUpgrade(req, socket, head, (ws) => {
      void (async () => {
        const user = await userFromToken(token);
        if (!user) {
          ws.close(4401);
          return;
        }
        log.info('ws_open', { userId: user.id });
        await serve(
          { send: (d) => ws.readyState === ws.OPEN && ws.send(d), onClose: (cb) => ws.once('close', cb) },
          user.id,
          () => patientRepo.patientIdsForUser(user.id),
        );
      })().catch((e) => {
        log.exception('ws_failed', e);
        ws.close(1011);
      });
    });
  });
  return wss;
}
