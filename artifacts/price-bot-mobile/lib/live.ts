import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import { currentSessionToken } from '@/lib/session';

// Which cached API data each server "topic" covers (query keys start with the URL).
const topicPrefixes: Record<string, string[]> = {
  catalog: ['/api/products', '/api/abbreviations', '/api/dashboard'],
  requests: ['/api/lookup-requests', '/api/dashboard'],
  targets: ['/api/targets'],
  surge: ['/api/surge'],
  users: ['/api/admins', '/api/system'],
  whatsapp: ['/api/integration/whatsapp', '/api/system'],
};

export function invalidateTopics(client: QueryClient, topics: string[] | 'all') {
  if (topics === 'all') { void client.invalidateQueries(); return; }
  const prefixes = ['/api/audit-log', ...topics.flatMap((topic) => topicPrefixes[topic] ?? [])];
  void client.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === 'string' && prefixes.some((prefix) => (query.queryKey[0] as string).startsWith(prefix)),
  });
}

/**
 * Live sync with the server (Server-Sent Events over XMLHttpRequest, which React
 * Native streams incrementally). Changes made anywhere — website, another phone,
 * the bot itself — show up here within a second. Closed while the app is in the
 * background; on return everything is refreshed once.
 */
export function useLiveSync(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let xhr: XMLHttpRequest | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 2000;
    let stopped = false;
    let connectedBefore = false;

    const handle = (block: string) => {
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'ready') {
        delay = 2000;
        if (connectedBefore) invalidateTopics(client, 'all');
        connectedBefore = true;
      } else if (event === 'invalidate') {
        try { invalidateTopics(client, JSON.parse(data).topics ?? []); } catch { /* ignore */ }
      }
    };

    const connect = () => {
      if (stopped) return;
      const request = new XMLHttpRequest();
      xhr = request;
      let seen = 0;
      let buffer = '';
      request.open('GET', `${apiUrl}/api/live`);
      request.setRequestHeader('Accept', 'text/event-stream');
      request.setRequestHeader('Cache-Control', 'no-cache');
      const token = currentSessionToken();
      if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.onprogress = () => {
        const text = request.responseText ?? '';
        buffer += text.slice(seen);
        seen = text.length;
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          handle(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf('\n\n');
        }
      };
      request.onreadystatechange = () => {
        if (request.readyState === 4 && xhr === request && !stopped) {
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      };
      request.send();
    };

    const close = () => {
      if (retry) clearTimeout(retry);
      retry = null;
      const current = xhr;
      xhr = null;
      current?.abort();
    };

    connect();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { if (!xhr && !stopped) connect(); }
      else close();
    });
    return () => { stopped = true; subscription.remove(); close(); };
  }, [enabled, client]);
}
