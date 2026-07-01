import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { CallsHistoryList } from './components/CallsHistoryList';
import { CommonSearchBar } from '../../components/common/CommonSearchBar';
import { CallSyncService, CallRecord } from './services/CallSyncService';

export default function CallsTab() {
  const { user: authUser } = useAuth();
  const navigate = useNavigate();
  
  const resolvedUserId = authUser?.id || 
                         (typeof window !== 'undefined' ? window.localStorage.getItem('grix_tg_user_id') : null) || 
                         (typeof window !== 'undefined' ? window.localStorage.getItem('grix_active_account_id') : null) || 
                         'me';

  // Instant load calls history from Cache
  const [calls, setCalls] = useState<CallRecord[]>(() => {
    return CallSyncService.getCachedCalls(resolvedUserId);
  });
  
  const [callsLoading, setCallsLoading] = useState(() => {
    const cached = CallSyncService.getCachedCalls(resolvedUserId);
    if (cached && cached.length > 0) return false;
    return true;
  });

  const [limit, setLimit] = useState(15);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPaginating, setIsPaginating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Keep references to current calls to prevent state-reset loop
  const callsRef = useRef(calls);

  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);

  // Sync state with Cache when resolvedUserId becomes resolved
  useEffect(() => {
    const cachedCalls = CallSyncService.getCachedCalls(resolvedUserId);
    if (cachedCalls && cachedCalls.length > 0) {
      setCalls(cachedCalls);
      setCallsLoading(false);
    }
  }, [resolvedUserId]);

  const fetchCalls = React.useCallback(async () => {
    if (!resolvedUserId) return;
    try {
      const cached = CallSyncService.getCachedCalls(resolvedUserId);
      const currentCalls = callsRef.current;
      const hasData = (currentCalls && currentCalls.length > 0) || (cached && cached.length > 0);
      
      if (isPaginating) {
        setLoadingMore(true);
      } else if (limit === 15) {
        if (!hasData) {
          setCallsLoading(true);
        }
      }

      const result = await CallSyncService.fetchCallsHistory(resolvedUserId, limit);
      
      setCalls(result.callList);
      setHasMore(result.hasMore);
    } catch (e) {
      console.error("Error fetching calls:", e);
    } finally {
      setCallsLoading(false);
      setLoadingMore(false);
      setIsPaginating(false);
    }
  }, [resolvedUserId, limit, isPaginating]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isScrollable = target.scrollHeight > target.clientHeight;
    const closeToBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 100;
    if (isScrollable && target.scrollTop > 5 && closeToBottom) {
      if (hasMore && !loadingMore && !callsLoading) {
        setIsPaginating(true);
        setLimit(prev => prev + 15);
      }
    }
  };

  useEffect(() => {
    fetchCalls();

    if (!resolvedUserId) return;

    // Realtime update hook via CallSyncService subscription helper
    const unsubscribe = CallSyncService.subscribeToCalls(resolvedUserId, () => {
      fetchCalls();
    });

    return () => {
      unsubscribe();
    };
  }, [resolvedUserId, fetchCalls]);

  const startCallDirectly = (userId: string, callType: 'voice' | 'video') => {
    navigate(`/call/${userId}?type=${callType}`);
  };

  const getFilteredCalls = () => {
    let filtered = calls;
    if (searchTerm) {
      filtered = filtered.filter(c => 
        (c.user || '').toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    return filtered;
  };

  return (
    <div 
      className="flex flex-col h-full bg-bg-card font-sans relative overflow-hidden"
      style={{ backgroundColor: 'var(--bg-card)' }}
    >
      <div 
        className="flex-1 flex flex-col min-h-0 bg-bg-card"
        style={{ backgroundColor: 'var(--bg-card)' }}
      >
        <div 
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto no-scrollbar pb-32 bg-bg-card"
          style={{ backgroundColor: 'var(--bg-card)' }}
        >
          {/* Search bar inside scroll viewport */}
          <CommonSearchBar 
            placeholder="Search calls..."
            value={searchTerm}
            onChange={setSearchTerm}
            onClear={() => setSearchTerm('')}
          />

          {/* List display area */}
          <div className="mt-1">
            <React.Fragment>
              <CallsHistoryList 
                calls={getFilteredCalls()} 
                loading={callsLoading} 
                onCall={startCallDirectly} 
                onReset={fetchCalls}
              />
              {loadingMore && (
                <div className="flex items-center justify-center py-4 gap-2 bg-[var(--bg-card)]">
                  <div className="w-4 h-4 border-2 border-[#0494f4]/20 border-t-[#0494f4] rounded-full animate-spin" />
                  <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">Loading more calls...</span>
                </div>
              )}
            </React.Fragment>
          </div>
        </div>
      </div>
    </div>
  );
}
