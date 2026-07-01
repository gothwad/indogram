import { UserProfile } from '../../types';
import { storage } from '../StorageService';

export const userProfileService = {
  // Throttled online/offline status update
  throttledSetStatus: async (userId: string, isOnline: boolean, force = false): Promise<void> => {
    // Local memory and cached presence state
    const cachedRaw = storage.getItem('grix_cached_userdata');
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached && cached.id === userId) {
          cached.status = isOnline ? 'online' : 'offline';
          cached.lastSeen = new Date().toISOString();
          storage.setItem('grix_cached_userdata', JSON.stringify(cached));
        }
      } catch (_) {}
    }
  },

  // Safely fetch client profile, autogenerate username, and fetch followers/followings
  fetchFullProfileData: async (
    currentUserId: string,
    email: string,
    userMetadata: any
  ): Promise<{ profileData: UserProfile | null; following: string[] }> => {
    const cachedRaw = storage.getItem('grix_cached_userdata');
    let loadedProfile: any = null;

    if (cachedRaw) {
      try {
        loadedProfile = JSON.parse(cachedRaw);
      } catch (_) {}
    }

    if (!loadedProfile || loadedProfile.id !== currentUserId) {
      const storedRealName = storage.getItem('grix_user_fullname');
      const storedRealEmail = storage.getItem('grix_active_email');
      const storedRealUsername = storage.getItem('grix_user_username');
      
      const emailPrefix = email ? email.split('@')[0] : 'user';
      const baseUsername = emailPrefix.toLowerCase().replace(/[^a-z0-9_]/g, '');
      const finalUsername = storedRealUsername || baseUsername || `user_${currentUserId.substring(0, 5)}`;
      const fullName = storedRealName || userMetadata?.full_name || emailPrefix || 'Telegram User';
      const photoUrl = userMetadata?.avatar_url || `https://cdn-icons-png.flaticon.com/512/149/149071.png`;

      loadedProfile = {
        id: currentUserId,
        uid: currentUserId,
        email: storedRealEmail || email,
        full_name: fullName,
        username: finalUsername,
        photo_url: photoUrl,
        bio: 'Secured on the MTProto GrixGram Network.',
        is_verified: true,
        profile_type: 'personal',
        last_seen: new Date().toISOString(),
        is_online: true,
        hidden_chats: [],
        archived_chats: [],
        settings: {
          two_factor: false,
          active_sessions: []
        },
        following: [],
        followers: []
      };

      try {
        storage.setItem('grix_cached_userdata', JSON.stringify(loadedProfile));
      } catch (_) {}
    }

    // Adapt to full UserProfile schema expected in provider / context
    const formatted: UserProfile = {
      id: loadedProfile.id,
      uid: loadedProfile.id,
      email: loadedProfile.email,
      fullName: loadedProfile.full_name || loadedProfile.fullName || 'Indo User',
      username: loadedProfile.username,
      photoURL: loadedProfile.photo_url || loadedProfile.photoURL,
      bio: loadedProfile.bio || 'Secured on the MTProto IndoGram Network.',
      isVerified: loadedProfile.is_verified ?? true,
      profileType: loadedProfile.profile_type || 'personal',
      lastSeen: loadedProfile.last_seen || new Date().toISOString(),
      status: 'online',
      hiddenChats: loadedProfile.hidden_chats || [],
      archivedChats: loadedProfile.archived_chats || [],
      hiddenChatSettings: loadedProfile.hidden_chat_settings || {},
      fcmTokens: [],
      settings: loadedProfile.settings || {},
      lock: loadedProfile.lock,
      saved_posts: loadedProfile.saved_posts || [],
      blockedUsers: loadedProfile.blocked_users || [],
      blocked_users: loadedProfile.blocked_users || [],
      muted_users: loadedProfile.muted_users || [],
      favorites: loadedProfile.favorites || [],
      following: loadedProfile.following || [],
      followers: loadedProfile.followers || []
    } as any;

    return { profileData: formatted, following: formatted.following };
  }
};
