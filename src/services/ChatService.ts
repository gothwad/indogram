import { LocalDataCache } from './LocalDataCache';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const chatService = {
  async sendMessage(
    conversationId: string, 
    senderId: string, 
    content: string, 
    mediaData?: { url: string; type: string },
    replyTo?: any
  ) {
    const newMessage: any = {
      id: `msg_tg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      conversation_id: conversationId,
      sender_id: senderId,
      text: content,
      content: content,
      media_url: mediaData?.url || null,
      media_type: mediaData?.type || null,
      reply_to: replyTo ? { id: replyTo.id, text: replyTo.text || replyTo.content || '', sender_id: replyTo.sender_id } : null,
      created_at: new Date().toISOString(),
      is_read: false,
      status: 'Sent' as const,
      sender: {
        id: senderId,
        username: localStorage.getItem('grix_user_username') || 'me',
        full_name: localStorage.getItem('grix_user_fullname') || 'GrixGram User',
        photo_url: '/assets/icon-512-maskable.png'
      }
    };

    // Real-time peer-to-peer / MTProto check to send direct live message to Telegram
    const sessionString = localStorage.getItem('grix_tg_string_session');
    if (sessionString && conversationId && conversationId !== 'indo_ai_bot' && conversationId !== 'grix_ai_bot') {
      try {
        const res = await fetch('/api/telegram/send-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            sessionString, 
            peerId: conversationId, 
            message: content,
            mediaUrl: mediaData?.url,
            mediaType: mediaData?.type,
            replyToMsgId: replyTo?.id
          })
        });
        const result = await res.json();
        if (result.success && result.message) {
          newMessage.id = result.message.id || newMessage.id;
          newMessage.created_at = result.message.created_at || newMessage.created_at;
          newMessage.sender_id = result.message.sender_id || newMessage.sender_id;
          if (result.message.media_url) {
            newMessage.media_url = result.message.media_url;
            newMessage.media_type = result.message.media_type;
          }
        }
      } catch (err) {
        console.error('[MTProto SendMessage API Failure]:', err);
      }
    }

    // Save message to LocalDataCache
    LocalDataCache.addMessageToCache(conversationId, newMessage);

    // Update conversation state in LocalDataCache
    const displayContent = content || (mediaData ? `Sent a ${mediaData.type}` : 'Sent an attachment');
    LocalDataCache.updateLastMessage(senderId, conversationId, displayContent, new Date().toISOString(), 'Sent');

    // Trigger automatic Indo AI reply if messaging the Bot
    if (conversationId === 'grix_ai_bot' || conversationId === 'indo_ai_bot') {
      const activeBotId = conversationId;
      setTimeout(async () => {
        try {
          const aiResponse = await fetch('/api/indo-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content }] })
          });
          const aiJson = await aiResponse.json();
          const replyText = aiJson.reply || `Hey! I am parsing global energy levels. Type "/help" to review my capabilities. 🌌`;
          
          const botMessage = {
            id: `msg_ai_pulse_${Date.now()}`,
            conversation_id: activeBotId,
            sender_id: activeBotId,
            text: replyText,
            content: replyText,
            media_url: null,
            media_type: null,
            reply_to: null,
            created_at: new Date().toISOString(),
            is_read: false,
            status: 'Received' as const,
            sender: {
              id: activeBotId,
              username: 'indo_builder_bot',
              full_name: 'Indo AI Assistant 🤖',
              photo_url: 'https://cdn-icons-png.flaticon.com/512/4712/4712109.png'
            }
          };
          LocalDataCache.addMessageToCache(activeBotId, botMessage);
          LocalDataCache.updateLastMessage(senderId, activeBotId, replyText, new Date().toISOString(), 'Received');
        } catch (err) {
          console.error('[Bot Reply Engine Error]:', err);
        }
      }, 1000);
    }

    return newMessage;
  },

  async getConversation(conversationId: string) {
    const list = LocalDataCache.getConversations('me') || [];
    return list.find((c: any) => c.id === conversationId) || null;
  },

  async updateConversation(conversationId: string, data: any) {
    const list = LocalDataCache.getConversations('me') || [];
    const updated = list.map((c: any) => {
      if (c.id === conversationId) {
        return { ...c, ...data };
      }
      return c;
    });
    LocalDataCache.saveConversations('me', updated);
    LocalDataCache.notify('conversations', updated);
  },

  async getMessages(conversationId: string, limitCount = 50) {
    const cached = LocalDataCache.getMessages(conversationId) || [];
    return cached.slice(-limitCount);
  },

  async getOrCreateDirectConversation(user1Id: string, user2Id: string) {
    const list = LocalDataCache.getConversations(user1Id) || [];
    const existing = list.find((c: any) => c.otherUserId === user2Id && c.type === 'direct');
    
    if (existing) return existing.id;

    // Create a new direct chat dynamically with the peer's real user ID as the chat ID
    const newId = user2Id;
    const isNumeric = /^\d+$/.test(user2Id);
    let displayName = user2Id;
    if (user2Id.startsWith('user_')) {
      const parts = user2Id.split('_');
      displayName = parts.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    } else if (isNumeric) {
      displayName = `Telegram User (${user2Id})`;
    } else {
      displayName = user2Id.charAt(0).toUpperCase() + user2Id.slice(1);
    }

    const newConv = {
      id: newId,
      type: 'direct' as const,
      otherUserId: user2Id,
      user: displayName,
      username: user2Id.startsWith('user_') ? user2Id : `tg_${user2Id}`,
      fullName: displayName,
      lastMsg: 'New Conversation Started',
      lastMsgAt: new Date().toISOString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }),
      avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
      unread: false,
      unreadCount: 0,
      isOnline: true,
      lastMsgStatus: 'Sent' as const
    };

    const updated = [newConv, ...list];
    LocalDataCache.saveConversations(user1Id, updated);
    LocalDataCache.notify('conversations', updated);

    return newId;
  }
};
