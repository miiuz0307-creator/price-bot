import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

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
  const prefixes = new Set(['/api/audit-log', ...topics.flatMap((topic) => topicPrefixes[topic] ?? [])]);
  void client.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === 'string' && [...prefixes].some((prefix) => (query.queryKey[0] as string).startsWith(prefix)),
  });
}

/** Live sync: reloads exactly what changed as soon as the server announces it. */
export function LiveSync() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const source = new EventSource(`${base}/api/live`, { withCredentials: true });
    let opened = false;
    source.addEventListener('ready', () => {
      // After a reconnect, catch up on anything missed while offline.
      if (opened) invalidateTopics(client, 'all');
      opened = true;
    });
    source.addEventListener('invalidate', (event) => {
      try { invalidateTopics(client, JSON.parse((event as MessageEvent).data).topics ?? []); } catch { /* ignore */ }
    });
    return () => source.close();
  }, [client]);
  return null;
}
