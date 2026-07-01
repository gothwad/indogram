// Client-side offline-first Supabase proxy for IndoGram
// This file decouples the application from the external Supabase server
// while maintaining 100% compatibility with the original component code.

import { LocalDataCache } from '../services/LocalDataCache';

// Helper to check if localStorage is available
const isLocalStorageAvailable = () => {
  try {
    const test = 'test';
    window.localStorage.setItem(test, test);
    window.localStorage.removeItem(test);
    return true;
  } catch (e) {
    return false;
  }
};

const storageGet = (key: string): string | null => {
  if (!isLocalStorageAvailable()) return null;
  let val = window.localStorage.getItem(key);
  if (val === null && key.startsWith('grix_')) {
    const indoKey = key.replace('grix_', 'indo_');
    val = window.localStorage.getItem(indoKey);
  } else if (val === null && key.startsWith('indo_')) {
    const grixKey = key.replace('indo_', 'grix_');
    val = window.localStorage.getItem(grixKey);
  }
  return val;
};

const storageSet = (key: string, val: string): void => {
  if (!isLocalStorageAvailable()) return;
  window.localStorage.setItem(key, val);
  if (key.startsWith('grix_')) {
    window.localStorage.setItem(key.replace('grix_', 'indo_'), val);
  } else if (key.startsWith('indo_')) {
    window.localStorage.setItem(key.replace('indo_', 'grix_'), val);
  }
};

const storageRemove = (key: string): void => {
  if (!isLocalStorageAvailable()) return;
  window.localStorage.removeItem(key);
  if (key.startsWith('grix_')) {
    window.localStorage.removeItem(key.replace('grix_', 'indo_'));
  } else if (key.startsWith('indo_')) {
    window.localStorage.removeItem(key.replace('indo_', 'grix_'));
  }
};

// Fluent query builder for mock database supporting comprehensive chainable operations
class MockQueryBuilder {
  private tableName: string;
  private isSingleQuery: boolean = false;
  private eqConditions: { column: string, value: any }[] = [];
  private searchFilter: string = '';
  private insertData: any = null;
  private updateData: any = null;
  private isDelete: boolean = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(fields: string = '*') {
    return this;
  }

  insert(data: any) {
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.updateData = data;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  eq(column: string, value: any) {
    this.eqConditions.push({ column, value });
    return this;
  }

  neq(column: string, value: any) { return this; }
  gt(column: string, value: any) { return this; }
  lt(column: string, value: any) { return this; }
  gte(column: string, value: any) { return this; }
  lte(column: string, value: any) { return this; }
  like(column: string, value: any) { return this; }
  ilike(column: string, value: any) { return this; }
  is(column: string, value: any) { return this; }
  in(column: string, value: any[]) { return this; }
  contains(column: string, value: any) { return this; }
  containedBy(column: string, value: any) { return this; }
  rangeAdj(column: string, value: any) { return this; }
  rangeLte(column: string, value: any) { return this; }
  rangeGte(column: string, value: any) { return this; }
  match(query: any) { return this; }
  filter(column: string, operator: string, value: any) { return this; }
  not(column: string, operator: string, value: any) { return this; }
  
  or(filters: string, options?: any) {
    this.searchFilter = filters || '';
    return this;
  }
  
  and(filters: string, options?: any) { return this; }
  order(column: string, options?: any) { return this; }
  limit(count: number) { return this; }
  range(from: number, to: number) { return this; }
  
  single() {
    this.isSingleQuery = true;
    return this;
  }
  
  maybeSingle() {
    this.isSingleQuery = true;
    return this;
  }
  
  csv() { return this; }

  // Allow promise-like behavior (then, catch) for await calls
  async then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    const sessionString = storageGet('grix_tg_string_session');
    let defaultData: any = [];
    let fetchError: any = null;

    try {
      if (sessionString) {
        // Authenticated with real Telegram! Let's fetch real live data!
        if (this.tableName === 'conversations') {
          const res = await fetch('/api/telegram/get-dialogs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionString })
          });
          const result = await res.json();
          if (result.success && result.conversations) {
            defaultData = result.conversations;
            
            // Apply filtering if targeting a specific chat / user conversion ID
            const idCond = this.eqConditions.find(c => c.column === 'id');
            if (idCond) {
              const matched = defaultData.find((c: any) => c.id === idCond.value || c.otherUserId === idCond.value);
              defaultData = matched ? (this.isSingleQuery ? matched : [matched]) : (this.isSingleQuery ? null : []);
            }
          } else if (result.error) {
            console.warn('[MTProto Dialogs Error]', result.error);
          }
        } else if (this.tableName === 'messages') {
          if (this.insertData) {
            const peerId = this.insertData.conversation_id || this.insertData.chat_id;
            const text = this.insertData.text || this.insertData.message || "";
            if (peerId && text) {
              const res = await fetch('/api/telegram/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionString, peerId, message: text })
              });
              const result = await res.json();
              if (result.success && result.message) {
                defaultData = [result.message];
              }
            }
          } else if (this.updateData) {
            const idCond = this.eqConditions.find(c => c.column === 'id');
            const convIdCond = this.eqConditions.find(c => c.column === 'conversation_id' || c.column === 'chat_id');
            const messageId = idCond ? idCond.value : null;
            const peerId = convIdCond ? convIdCond.value : null;
            const newText = this.updateData.text || this.updateData.message || "";
            
            if (peerId && messageId && newText) {
              const res = await fetch('/api/telegram/edit-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionString, peerId, messageId, text: newText })
              });
              const result = await res.json();
              if (result.success) {
                defaultData = [{ id: messageId, text: newText }];
              }
            }
          } else if (this.isDelete) {
            const idCond = this.eqConditions.find(c => c.column === 'id');
            const convIdCond = this.eqConditions.find(c => c.column === 'conversation_id' || c.column === 'chat_id');
            const messageId = idCond ? idCond.value : null;
            const peerId = convIdCond ? convIdCond.value : null;
            
            if (peerId && messageId) {
              const res = await fetch('/api/telegram/delete-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionString, peerId, messageId })
              });
              const result = await res.json();
              if (result.success) {
                defaultData = [];
              }
            }
          } else {
            const convIdCond = this.eqConditions.find(c => c.column === 'conversation_id' || c.column === 'chat_id');
            if (convIdCond) {
              const peerId = convIdCond.value;
              const res = await fetch('/api/telegram/get-messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionString, peerId })
              });
              const result = await res.json();
              if (result.success && result.messages) {
                defaultData = result.messages;
              }
            }
          }
        } else if (this.tableName === 'users' || this.tableName === 'profiles') {
          if (this.isSingleQuery) {
            const idCond = this.eqConditions.find(c => c.column === 'id' || c.column === 'uuid');
            if (idCond && idCond.value === storageGet('grix_active_account_id')) {
              defaultData = {
                id: idCond.value,
                email: storageGet('grix_active_email') || 'grixgram@gmail.com',
                full_name: storageGet('grix_user_fullname') || 'GrixGram User',
                username: storageGet('grix_user_username') || 'grixgram_dev',
                bio: 'Unofficial premium Telegram Web Client.',
                photo_url: '/assets/icon-512-maskable.png',
                status: 'online',
                is_online: true
              };
            } else if (this.searchFilter) {
              const res = await fetch('/api/telegram/search-global', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionString, query: this.searchFilter })
              });
              const result = await res.json();
              if (result.success && result.users) {
                defaultData = result.users;
              }
            } else if (idCond) {
              const myId = storageGet('grix_active_account_id') || 'guest_user_id';
              const cachedConvs = LocalDataCache.getConversations(myId) || [];
              const match = cachedConvs.find((c: any) => c.otherUserId === idCond.value || c.id === idCond.value);
              if (match) {
                defaultData = {
                  id: idCond.value,
                  full_name: match.fullName || match.user || 'Telegram User',
                  username: match.username || 'user_' + idCond.value,
                  photo_url: match.avatar || `https://images.unsplash.com/photo-1542751371-adc38448a05e?w=150`,
                  status: match.isOnline ? 'online' : 'offline',
                  is_online: match.isOnline,
                  last_seen: match.lastSeen || match.lastMsgAt || null
                };
              } else {
                defaultData = {
                  id: idCond.value,
                  full_name: 'Telegram User',
                  username: 'user_' + idCond.value,
                  photo_url: `https://images.unsplash.com/photo-1542751371-adc38448a05e?w=150`
                };
              }
            }
          } else if (this.searchFilter) {
            const res = await fetch('/api/telegram/search-global', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionString, query: this.searchFilter })
            });
            const result = await res.json();
            if (result.success && result.users) {
              defaultData = result.users;
            }
          }
        }
      }
    } catch (err) {
      console.warn("[MTProto Live Fetch Exception] Falling back to default cached layer:", err);
      fetchError = err;
    }

    if (!defaultData || defaultData.length === 0) {
      if (this.tableName === 'users' || this.tableName === 'profiles') {
        const myId = storageGet('grix_active_account_id') || 'guest_user_id';
        const myEmail = storageGet('grix_active_email') || 'grixgram@gmail.com';
        
        const myProfile = {
          id: myId,
          email: myEmail,
          fcm_tokens: [],
          status: 'online',
          is_online: true,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          username: storageGet('grix_user_username') || 'grixgram_dev',
          full_name: storageGet('grix_user_fullname') || 'GrixGram User',
          bio: 'Cloning premium unofficial Telegram Web Client.',
          photo_url: '/assets/icon-512-maskable.png',
          hiddenChats: [],
          blocked_users: []
        };

        const mockTelegramUsers: any[] = [];

        if (this.isSingleQuery) {
          const idCond = this.eqConditions.find(c => c.column === 'id' || c.column === 'uuid');
          if (idCond) {
            const match = idCond.value === myId ? myProfile : null;
            defaultData = match || {
              id: idCond.value,
              email: `${idCond.value}@indogram.org`,
              fcm_tokens: [],
              status: 'offline',
              is_online: false,
              last_seen: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              username: 'user_' + idCond.value,
              full_name: 'Telegram User',
              bio: 'Telegram User Profile',
              photo_url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=150',
              hiddenChats: [],
              blocked_users: []
            };
          } else {
            defaultData = myProfile;
          }
        } else {
          if (this.searchFilter) {
            defaultData = [];
          } else {
            defaultData = [];
          }
        }
      } else if (this.tableName === 'messages') {
        const convIdCond = this.eqConditions.find(c => c.column === 'conversation_id' || c.column === 'chat_id');
        if (convIdCond) {
          const cachedMsgs = LocalDataCache.getMessages(convIdCond.value);
          if (cachedMsgs && cachedMsgs.length > 0) {
            defaultData = cachedMsgs;
          } else {
            defaultData = [];
          }
        } else {
          defaultData = [];
        }
      } else if (this.tableName === 'conversations') {
        const myId = storageGet('grix_active_account_id') || 'guest_user_id';
        const cachedConvs = LocalDataCache.getConversations(myId) || [];
        
        const idCond = this.eqConditions.find(c => c.column === 'id');
        if (idCond) {
          const matched = cachedConvs.find((c: any) => c.id === idCond.value || c.otherUserId === idCond.value);
          defaultData = matched ? (this.isSingleQuery ? matched : [matched]) : (this.isSingleQuery ? null : []);
        } else {
          defaultData = cachedConvs;
        }
      } else {
        defaultData = [];
      }
    }

    if (this.tableName === 'stories') {
      const myId = storageGet('grix_active_account_id') || 'guest_user_id';
      if (this.insertData) {
        const storyId = 'story_' + Date.now();
        const myName = storageGet('grix_user_fullname') || 'GrixGram User';
        const shadowUsername = storageGet('grix_user_username') || 'grixgram_dev';
        const newStory = {
          id: storyId,
          user_id: myId,
          created_at: new Date().toISOString(),
          type: this.insertData.type || 'text',
          media_url: this.insertData.media_url,
          text_content: this.insertData.text_content,
          bg_color: this.insertData.bg_color,
          filter_applied: this.insertData.filter_applied,
          music_title: this.insertData.music_title,
          music_artist: this.insertData.music_artist,
          music_url: this.insertData.music_url,
          users: {
            id: myId,
            username: shadowUsername,
            full_name: myName,
            photo_url: '/assets/icon-512-maskable.png'
          }
        };
        const currentStories = LocalDataCache.getHomeStories(myId) || [];
        const updatedStories = [newStory, ...currentStories];
        LocalDataCache.saveHomeStories(myId, updatedStories);
        defaultData = [newStory];
      } else {
        defaultData = LocalDataCache.getHomeStories(myId) || [];
      }
    }

    const value = { data: defaultData, error: fetchError };
    if (onfulfilled) {
      return Promise.resolve(value).then(onfulfilled, onrejected);
    }
    return Promise.resolve(value);
  }
}

class MockChannel {
  private channelName: string;
  constructor(channelName: string) {
    this.channelName = channelName;
  }

  on(event: string, filter: any, callback?: any) {
    console.log(`[Realtime Mock] Channel "${this.channelName}" registering ".on" for event: ${event}`);
    return this;
  }

  subscribe(callback?: any) {
    console.log(`[Realtime Mock] Channel "${this.channelName}" subscribed`);
    if (callback) {
      setTimeout(() => {
        try {
          callback('SUBSCRIBED');
        } catch (e) {
          console.warn('[Realtime Mock] Callback error:', e);
        }
      }, 0);
    }
    return this;
  }

  unsubscribe() {
    console.log(`[Realtime Mock] Channel "${this.channelName}" unsubscribed`);
    return Promise.resolve();
  }

  track(state?: any) {
    console.log(`[Realtime Mock] Channel "${this.channelName}" tracking:`, state);
    return this;
  }

  untrack() {
    console.log(`[Realtime Mock] Channel "${this.channelName}" untracked`);
    return Promise.resolve();
  }
}

// Complete Mock Interface
export const supabase = {
  auth: {
    signOut: async () => {
      console.log('[Auth Mock] Signing out active profile');
      storageRemove('grix_active_account_id');
      storageRemove('grix_active_email');
      return { error: null };
    },
    updateUser: async (attributes: any) => {
      console.log('[Auth Mock] Updating user attributes:', attributes);
      if (attributes.email) {
        storageSet('grix_active_email', attributes.email);
      }
      return { data: { user: { email: attributes.email } }, error: null };
    },
    resend: async (req: any) => {
      console.log('[Auth Mock] Resending code:', req);
      return { data: {}, error: null };
    },
    verifyOtp: async (req: any) => {
      console.log('[Auth Mock] Verifying OTP code:', req);
      const email = req.email || 'grixgram@gmail.com';
      storageSet('grix_active_account_id', 'user_' + Date.now());
      storageSet('grix_active_email', email);
      return { data: { user: { id: 'user_' + Date.now(), email } }, error: null };
    },
    signInWithPassword: async (credentials: any) => {
      console.log('[Auth Mock] Logging in with password email:', credentials.email);
      storageSet('grix_active_account_id', 'user_' + Date.now());
      storageSet('grix_active_email', credentials.email);
      return { data: { user: { id: 'user_' + Date.now(), email: credentials.email } }, error: null };
    },
    signUp: async (credentials: any) => {
      console.log('[Auth Mock] Registering accounts with:', credentials.email);
      storageSet('grix_active_account_id', 'user_' + Date.now());
      storageSet('grix_active_email', credentials.email);
      return { data: { user: { id: 'user_' + Date.now(), email: credentials.email } }, error: null };
    },
    signInWithOAuth: async (options: any) => {
      console.log('[Auth Mock] OAuth initialization via:', options.provider);
      return { data: { url: window.location.origin }, error: null };
    },
    resetPasswordForEmail: async (email: string, options: any) => {
      console.log('[Auth Mock] Reset password requested for email:', email);
      return { data: {}, error: null };
    },
    getUser: async () => {
      const activeId = storageGet('grix_active_account_id');
      const activeEmail = storageGet('grix_active_email') || 'grixgram@gmail.com';
      if (!activeId) {
        return { data: { user: null }, error: null };
      }
      return { data: { user: { id: activeId, email: activeEmail } }, error: null };
    },
    getSession: async () => {
      const activeId = storageGet('grix_active_account_id');
      const activeEmail = storageGet('grix_active_email') || 'grixgram@gmail.com';
      if (!activeId) {
        return { data: { session: null }, error: null };
      }
      return {
        data: {
          session: {
            access_token: 'mock-session-token',
            refresh_token: 'mock-refresh-token',
            user: { id: activeId, email: activeEmail }
          }
        },
        error: null
      };
    },
    setSession: async (tokens: any) => {
      console.log('[Auth Mock] Set session manually with token credentials');
      storageSet('grix_active_account_id', 'user_session_id');
      return { data: { session: { user: { id: 'user_session_id', email: 'grixgram@gmail.com' } } }, error: null };
    },
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      console.log('[Auth Mock] Listeners registered for state changes.');
      // Return a standard unsubscribe layout
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              console.log('[Auth Mock] Listener successfully unsubscribed');
            }
          }
        }
      };
    }
  },

  from: (tableName: string) => {
    return new MockQueryBuilder(tableName) as any;
  },

  channel: (channelName: string, config?: any) => {
    return new MockChannel(channelName) as any;
  },

  removeChannel: (channel: any) => {
    console.log('[Realtime Mock] Pruned live listener channels safely.');
  },

  rpc: async (fnName: string, args?: any) => {
    console.log(`[RPC Mock] Calling serverless RPC function "${fnName}" with values:`, args);
    if (fnName === 'get_direct_conversation_id') {
      const convId = `gx_direct_${args.u1}_${args.u2}`;
      return { data: convId, error: null };
    }
    return { data: {}, error: null };
  },

  storage: {
    from: (bucket: string) => {
      return {
        upload: async (uploadedPath: string, file: any, options: any) => {
          console.log(`[Storage Mock] Uploading assets to bucket "${bucket}" under path: ${uploadedPath}`);
          return { data: { path: uploadedPath }, error: null };
        },
        getPublicUrl: (filePath: string) => {
          // Fallback path mapping
          return { data: { publicUrl: filePath } };
        },
        remove: async (paths: string[]) => {
          console.log(`[Storage Mock] Expiring items from storage:`, paths);
          return { error: null };
        }
      };
    }
  }
} as any;

export const getSupabase = () => supabase;
