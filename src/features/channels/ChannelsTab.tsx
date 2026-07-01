import React, { useCallback } from 'react';
import { useSearch } from '../../contexts/SearchContext.tsx';
import { useNavigate } from 'react-router-dom';
import { Radio, Loader2, ArrowRight } from 'lucide-react';
import { useLayout } from '../../contexts/LayoutContext.tsx';
import { useConversations } from '../chat/hooks/useConversations.ts';
import { ChatUserList } from '../chat/components/ChatUserList.tsx';
import { CommonSearchBar } from '../../components/common/CommonSearchBar';

export default function ChannelsTab() {
  const navigate = useNavigate();
  const { searchTerm, setSearchTerm } = useSearch();
  const { isChatSelectMode } = useLayout();
  
  // Load conversation lists
  const { 
    conversations, 
    loading, 
    loadingMore, 
    hasMore, 
    loadMore 
  } = useConversations('Chats');

  // Filter conversations for channels
  const filteredChannels = conversations.filter(c => {
    // A channel is recognized by being a group-type peer named "channel" or matching specific IDs
    const isChannel = c.id === 'tg_news_channel' || c.type === 'channel' || (c.type === 'group' && c.id.toLowerCase().includes('channel'));
    if (!isChannel) return false;

    if (!searchTerm) return true;
    return (c.user || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
           (c.username || "").toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isScrollable = target.scrollHeight > target.clientHeight;
    const closeToBottom = target.scrollHeight - target.scrollTop - target.clientHeight <= 100;
    if (isScrollable && target.scrollTop > 5 && closeToBottom) {
      if (hasMore && !loadingMore) {
        loadMore();
      }
    }
  }, [hasMore, loadingMore, loadMore]);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-card)] overflow-hidden animate-fade-in touch-pan-y">
      <div onScroll={handleScroll} className="flex-1 overflow-y-auto no-scrollbar pb-32 bg-[var(--bg-card)]">
        {/* Scrollable Search Bar */}
        <CommonSearchBar 
          placeholder="Search subscribed channels..."
          value={searchTerm}
          onChange={setSearchTerm}
          onClear={() => setSearchTerm('')}
        />

        {/* Channels List */}
        <div className="flex flex-col mt-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="animate-spin text-[#0494f4]" size={24} />
              <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-widest">Loading Channels...</p>
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-4">
              <div className="p-4 bg-[var(--bg-main)] rounded-2xl text-[var(--text-secondary)] hover:bg-[#0494f4]/5 shadow-sm border border-[var(--border-color)]/10 transition-colors">
                <Radio size={36} className="opacity-80 text-[#0494f4]" />
              </div>
              <div className="max-w-xs">
                <h3 className="text-xs font-black text-[var(--text-primary)] mb-1 uppercase tracking-wider">No Channels Joined</h3>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Join broadcasting channels or parse global search to subscribe to feeds and news items.
                </p>
                <button 
                  onClick={() => navigate('/new-group?type=channel')}
                  className="mt-4 px-4 py-2 bg-[#0494f4]/10 hover:bg-[#0494f4]/20 text-[#0494f4] font-extrabold text-[10px] uppercase tracking-wider rounded-xl inline-flex items-center gap-1.5 transition-all active:scale-95"
                >
                  <span>Create Channel</span>
                  <ArrowRight size={10} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <ChatUserList 
                conversations={filteredChannels}
                otherUsers={[]}
                showGrixAI={false}
                archivedCount={0}
                showSecretHeader={false}
                emptyMessage="No active channels"
                emptySubMessage="Broadcast channel items wait to load here."
                loading={loading}
                usersWithStories={[]}
                showHiddenChatsEntry={false}
              />
              {loadingMore && (
                <div className="flex items-center justify-center py-4 gap-2 bg-[var(--bg-card)]">
                  <Loader2 size={16} className="text-[#0494f4] animate-spin" />
                  <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">Loading more channels...</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
