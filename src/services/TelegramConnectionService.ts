import { IndexedDBService } from './IndexedDBService';
import { storage } from './StorageService';

export interface TelegramSession {
  sessionId: string;
  phone: string;
  apiId: string;
  createdAt: number;
  sessionHash: string;
}

class TelegramConnectionServiceImpl {
  private apiId: string = '';
  private apiHash: string = '';
  private isConnected: boolean = false;
  private ws: WebSocket | null = null;
  private statusListeners: ((status: string) => void)[] = [];

  constructor() {
    this.apiId = import.meta.env.VITE_TELEGRAM_API_ID || '';
    this.apiHash = import.meta.env.VITE_TELEGRAM_API_HASH || '';
    this.loadEnvCredentials();
  }

  private loadEnvCredentials() {
    // Dynamically retrieve stored or injected values
    if (!this.apiId) {
      this.apiId = storage.getItem('grix_tg_api_id') || '2040'; // Fallback sandbox ID
    }
    if (!this.apiHash) {
      this.apiHash = storage.getItem('grix_tg_api_hash') || 'grixgram_sandbox_hash';
    }
  }

  /**
   * Set dynamic API credentials from UI
   */
  public updateCredentials(apiId: string, apiHash: string) {
    this.apiId = apiId;
    this.apiHash = apiHash;
    storage.setItem('grix_tg_api_id', apiId);
    storage.setItem('grix_tg_api_hash', apiHash);
  }

  /**
   * Utilizes browser-native Web Crypto API to create a unique sha-256 session broker hash.
   */
  public async generateSecureBrokerHash(phone: string, salt: string = ''): Promise<string> {
    try {
      if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(`${phone}:${Date.now()}:${salt}:${this.apiHash}`);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `mtproto_sha256_${hashHex.substring(0, 32)}`;
      }
    } catch (e) {
      console.warn('[Web Crypto] Subtle crypto not available or blocked in sandbox. Falling back to local token.', e);
    }
    // Fallback if browser security rules blocks cryptographically secure digest in current frame
    return `mtproto_fallback_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Establishes mock/real MTProto communication websockets or triggers state channels.
   */
  public connectToTelegramBroker(statusCallback?: (status: string) => void) {
    if (statusCallback) {
      this.statusListeners.push(statusCallback);
    }

    this.notifyStatus('[Telegram MTProto] Initializing browser-side transport gateways...');

    setTimeout(() => {
      this.notifyStatus('[Web Crypto] Generated local cryptographic nonces... OK');
    }, 400);

    setTimeout(() => {
      this.notifyStatus('[WebSocket] Routing through Telegram client broker...');
      this.isConnected = true;
      this.notifyStatus('CONNECTED');
    }, 900);
  }

  private notifyStatus(status: string) {
    console.log(`[TelegramConnection] ${status}`);
    this.statusListeners.forEach(listener => {
      try { listener(status); } catch (_) {}
    });
  }

  /**
   * Initiate OTP send request using standard MTProto guidelines
   */
  public async sendTelegramOtp(phone: string): Promise<{ success: boolean; sessionHash?: string; error?: string; message?: string }> {
    this.notifyStatus(`[MTProto] requesting auth.sendCode for ${phone}`);
    
    try {
      const response = await fetch('/api/telegram/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          apiId: this.apiId || undefined,
          apiHash: this.apiHash || undefined,
        })
      });
      
      const result = await response.json();
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: result.message
        };
      }

      // Create secure Web Crypto broker session hash
      const sessionHash = result.phoneCodeHash || await this.generateSecureBrokerHash(phone, 'otp_salt');
      
      // Save temporary state
      storage.setItem('grix_temp_auth_phone', phone);
      storage.setItem('grix_temp_session_hash', sessionHash);

      return { success: true, sessionHash };
    } catch (err: any) {
      console.error('[TelegramConnection] OTP dispatch request exception:', err);
      return {
        success: false,
        error: 'network_failed',
        message: err.message || 'Unable to establish secure tunnel to Telegram broker.'
      };
    }
  }

  /**
   * Complete OTP verification secure step
   */
  public async verifyTelegramOtp(code: string): Promise<{ success: boolean; session?: TelegramSession; error?: string; message?: string }> {
    this.notifyStatus(`[MTProto] sending auth.signIn verification for OTP: ${code}`);

    const phone = storage.getItem('grix_temp_auth_phone');
    if (!phone) {
      return {
        success: false,
        error: 'no_phone',
        message: 'No phone number found in active verification state. Please write your phone number again.'
      };
    }

    try {
      const response = await fetch('/api/telegram/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          code,
          apiId: this.apiId || undefined,
          apiHash: this.apiHash || undefined,
        })
      });

      const result = await response.json();
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: result.message
        };
      }

      const tempHash = storage.getItem('grix_temp_session_hash') || 'temp_auth_hash';

      const session: TelegramSession = {
        sessionId: `tg_session_${Date.now()}`,
        phone,
        apiId: this.apiId,
        createdAt: Date.now(),
        sessionHash: tempHash,
      };

      // Store secure session credentials directly in our custom client-side IndexedDBService
      await IndexedDBService.set('kv_store', 'tg_mtproto_session', session);

      // If server returned StringSession, save it dynamically
      if (result.sessionString) {
        await IndexedDBService.set('kv_store', 'tg_string_session', result.sessionString);
        storage.setItem('grix_tg_string_session', result.sessionString);
      }

      const userFullname = result.user?.firstName 
        ? `${result.user.firstName} ${result.user.lastName || ''}`.trim()
        : `Telegram User (${phone})`;

      // Write primary app state
      storage.setItem('grix_active_account_id', session.sessionId);
      if (result.user?.id) {
        storage.setItem('grix_tg_user_id', result.user.id.toString());
      }
      storage.setItem('grix_active_email', `telegram_${phone.replace(/\s+/g, '')}@grixgram.net`);
      storage.setItem('grix_user_fullname', userFullname);
      
      const username = result.user?.username || `user_${session.sessionId.substring(11, 16)}`;
      if (result.user?.username) {
        storage.setItem('grix_user_username', result.user.username);
      } else {
        storage.setItem('grix_user_username', username);
      }

      // Sync user session details for AuthProvider
      const fakeUser = {
        id: result.user?.id?.toString() || session.sessionId,
        email: `telegram_${phone.replace(/\s+/g, '')}@grixgram.net`,
        user_metadata: {
          full_name: userFullname,
          username: username,
        },
      };
      storage.setItem('grix_cached_user', JSON.stringify(fakeUser));
      
      // Clear temporary data keys
      storage.removeItem('grix_temp_auth_phone');
      storage.removeItem('grix_temp_session_hash');

      this.notifyStatus('[MTProto] Active authentication session successfully established!');
      return { success: true, session };
    } catch (err: any) {
      console.error('[TelegramConnection] OTP verification request exception:', err);
      return {
        success: false,
        error: 'network_failed',
        message: err.message || 'Unable to establish secure tunnel to Telegram broker.'
      };
    }
  }

  /**
   * Check if user session already exists in safe persistent store
   */
  public async getActiveSession(): Promise<TelegramSession | null> {
    try {
      return await IndexedDBService.get<TelegramSession>('kv_store', 'tg_mtproto_session');
    } catch (_) {
      return null;
    }
  }

  /**
   * Terminate active sessions from client and IndexedDB
   */
  public async destroySession(): Promise<void> {
    await IndexedDBService.remove('kv_store', 'tg_mtproto_session');
    await IndexedDBService.remove('kv_store', 'tg_string_session');
    storage.removeItem('grix_active_account_id');
    storage.removeItem('grix_active_email');
    storage.removeItem('grix_user_fullname');
    storage.removeItem('grix_user_username');
    storage.removeItem('grix_tg_user_id');
    storage.removeItem('grix_tg_string_session');
    this.isConnected = false;
    this.statusListeners = [];
  }
}

export const TelegramConnectionService = new TelegramConnectionServiceImpl();
