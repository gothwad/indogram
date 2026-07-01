import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../providers/AuthProvider.tsx';
import { CallSyncService, CallRecord } from '../../call/services/CallSyncService';

export const useCalls = (activeFilter: string) => {
  const { user } = useAuth();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [limit, setLimit] = useState(20);

  const resolvedUserId = user?.id || 
                         (typeof window !== 'undefined' ? window.localStorage.getItem('grix_tg_user_id') : null) || 
                         (typeof window !== 'undefined' ? window.localStorage.getItem('grix_active_account_id') : null) || 
                         'me';

  const fetchCalls = useCallback(async (isLoadMore = false) => {
    if (activeFilter !== 'Calls' || !resolvedUserId) return;
    
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await CallSyncService.fetchCallsHistory(resolvedUserId, limit);
      setCalls(result.callList);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('[useCalls] Error fetching calls:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeFilter, resolvedUserId, limit]);

  useEffect(() => {
    fetchCalls();

    if (activeFilter !== 'Calls' || !resolvedUserId) return;

    const unsubscribe = CallSyncService.subscribeToCalls(resolvedUserId, () => {
      fetchCalls();
    });

    return () => {
      unsubscribe();
    };
  }, [activeFilter, resolvedUserId, fetchCalls]);

  const loadMore = useCallback(() => {
    if (hasMore && !loadingMore) {
      setLimit(prev => prev + 20);
    }
  }, [hasMore, loadingMore]);

  return { 
    calls, 
    loading, 
    loadingMore, 
    hasMore, 
    loadMore 
  };
};
