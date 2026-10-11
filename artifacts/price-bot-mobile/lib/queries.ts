import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDashboardSummaryQueryKey, getGetSurgeStatusQueryKey, getGetWhatsAppStatusQueryKey,
  getListLookupRequestsQueryKey, getListProductsQueryKey,
  useGetSurgeStatus, useGetWhatsAppStatus, useListLookupRequests,
} from '@workspace/api-client-react';

/** Shared, auto-refreshing queries (one cache entry per endpoint, reused by every screen). */
export const usePendingRequests = () =>
  useListLookupRequests({ query: { queryKey: getListLookupRequestsQueryKey(), refetchInterval: 30_000 } });

export const useWhatsApp = (fast = false) =>
  useGetWhatsAppStatus({ query: { queryKey: getGetWhatsAppStatusQueryKey(), refetchInterval: fast ? 3_000 : 30_000 } });

export const useSurge = () =>
  useGetSurgeStatus({ query: { queryKey: getGetSurgeStatusQueryKey(), refetchInterval: 15_000 } });

export function useInvalidate() {
  const client = useQueryClient();
  return {
    catalog: () => Promise.all([
      client.invalidateQueries({ queryKey: getListProductsQueryKey() }),
      client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
    ]),
    requests: () => client.invalidateQueries({ queryKey: getListLookupRequestsQueryKey() }),
    surge: () => client.invalidateQueries({ queryKey: getGetSurgeStatusQueryKey() }),
    whatsapp: () => client.invalidateQueries({ queryKey: getGetWhatsAppStatusQueryKey() }),
    all: () => client.invalidateQueries(),
  };
}
