import { supabase } from '../../../lib/telegramClient';
import { LocalDataCache } from '../../../services/LocalDataCache';

export interface CallRecord {
  id: string;
  otherUserId: string;
  user: string;
  avatar: string;
  type: 'voice' | 'video' | 'group' | string;
  isIncoming: boolean;
  isMissed: boolean;
  time: string;
  created_at?: string;
}

class CallSyncServiceImpl {
  /**
   * Instantly load calls history from Synchronous Memory Layer / IndexedDB backplane.
   */
  public getCachedCalls(userId: string): CallRecord[] {
    if (!userId) return [];
    const cached = LocalDataCache.get<any[]>(`gx_calls_history_${userId}`);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached as CallRecord[];
    }
    return [];
  }

  /**
   * Save a set of call records explicitly to local cache.
   */
  public saveCachedCalls(userId: string, calls: CallRecord[]): void {
    if (!userId) return;
    LocalDataCache.set(`gx_calls_history_${userId}`, calls);
  }

  /**
   * Fetch call history from the Telegram service, with support for cursor/limit,
   * map records nicely, and sync them back to local cache.
   */
  public async fetchCallsHistory(
    userId: string,
    limit: number
  ): Promise<{ callList: CallRecord[]; hasMore: boolean }> {
    if (!userId) {
      return { callList: [], hasMore: false };
    }

    try {
      const sessionString = typeof window !== 'undefined' ? window.localStorage.getItem('grix_tg_string_session') : null;
      if (!sessionString) {
        return { callList: [], hasMore: false };
      }

      const response = await fetch('/api/telegram/get-calls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionString, limit })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.callList)) {
        this.saveCachedCalls(userId, data.callList);
        return { callList: data.callList, hasMore: false };
      }

      return { callList: this.getCachedCalls(userId), hasMore: false };
    } catch (err) {
      console.error('[CallSyncService] Error fetching call logs:', err);
      const cached = this.getCachedCalls(userId);
      return { callList: cached, hasMore: false };
    }
  }

  /**
   * Set up a lightweight listener to listen to call changes
   */
  public subscribeToCalls(userId: string, onUpdate: () => void): () => void {
    // No-op for direct MTProto client-side calling updates
    return () => {};
  }
}

export const CallSyncService = new CallSyncServiceImpl();
