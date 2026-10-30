import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { refreshTokens, wsUrl } from '../api/client';
import { qk } from '../api/keys';
import { loadTokens } from '../auth/tokenStore';

export type RealtimeMessage = { type: string; patientId?: number; data?: Record<string, unknown>; ts?: string };

const BACKOFF_MS = [1000, 2000, 5000, 10000];

/** Server messages are hints: invalidate the matching queries (see mobile-expo skill). */
export function applyMessage(qc: QueryClient, msg: RealtimeMessage) {
  const pid = msg.patientId;
  switch (msg.type) {
    case 'intake.updated':
    case 'device.updated':
    case 'medicine.updated':
    case 'patient.updated':
      if (pid) qc.invalidateQueries({ queryKey: qk.patient(pid) });
      qc.invalidateQueries({ queryKey: qk.dashboard() });
      break;
    case 'alert.created':
      qc.invalidateQueries({ queryKey: qk.alerts() });
      qc.invalidateQueries({ queryKey: qk.dashboard() });
      break;
    case 'scan.created':
      if (pid) qc.invalidateQueries({ queryKey: qk.scans(pid) });
      break;
    case 'patients.changed':
      qc.invalidateQueries({ queryKey: qk.patients() });
      qc.invalidateQueries({ queryKey: qk.dashboard() });
      break;
  }
}

type Realtime = { connected: boolean; lastAlertAt: number };
const RealtimeContext = createContext<Realtime>({ connected: false, lastAlertAt: 0 });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastAlertAt, setLastAlertAt] = useState(0);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = async () => {
      if (stopped || socket.current) return;
      let tokens = await loadTokens();
      if (!tokens) return;
      if (attempt > 0) tokens = (await refreshTokens()) ?? tokens; // the access token may have expired
      const ws = new WebSocket(wsUrl(tokens.accessToken));
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        // Catch up on anything missed while disconnected.
        qc.invalidateQueries();
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as RealtimeMessage;
          applyMessage(qc, msg);
          if (msg.type === 'alert.created') setLastAlertAt(Date.now());
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        socket.current = null;
        setConnected(false);
        if (stopped) return;
        timer = setTimeout(connect, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
        attempt += 1;
      };
      ws.onerror = () => ws.close();
    };

    connect();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !socket.current) {
        clearTimeout(timer);
        attempt = 0;
        connect();
      }
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      sub.remove();
      socket.current?.close();
      socket.current = null;
    };
  }, [qc]);

  return <RealtimeContext.Provider value={{ connected, lastAlertAt }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
