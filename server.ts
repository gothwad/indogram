import express from "express";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import multer from "multer";
import FormData from "form-data";
import fs from "fs";
import os from "os";
import { GoogleAuth } from "google-auth-library";
import { GoogleGenAI } from "@google/genai";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

// Temporary in-memory storage cache for active Telegram MTProto clients and verification hashes
const activeTelegramClients = new Map<string, TelegramClient>();
const activeTelegramHashes = new Map<string, string>();
// Inline stubs to replace removed heavy C++ native packages or obsolete platform SDKs
class AccessToken {
  constructor(...args: any[]) {}
  addGrant(...args: any[]) {}
  toJwt() { return Promise.resolve("mock-livekit-token-sandbox"); }
}
const createClient = (...args: any[]) => ({
  from: (table: string) => ({
    select: (fields?: string) => Promise.resolve({ data: [], error: null }),
    update: (data: any) => ({
      eq: (col: string, val: any) => Promise.resolve({ error: null })
    })
  })
});

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

// GitHub OAuth Config
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// Configure Multer for temporary storage in the OS temp directory
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "IndoGram Server is running" });
});

// Real Telegram MTProto OTP Dispatch Router
app.post("/api/telegram/send-code", async (req, res) => {
  try {
    const { phone, apiId: customApiId, apiHash: customApiHash } = req.body;
    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Capture standard or custom credentials
    const apiIdStr = customApiId || process.env.VITE_TELEGRAM_API_ID;
    const apiHashStr = customApiHash || process.env.VITE_TELEGRAM_API_HASH;

    if (!apiIdStr || !apiHashStr) {
      return res.json({
        success: false,
        error: "credentials_missing",
        message: "Telegram API ID and API Hash are not configured yet. Please open the Settings menu or configure them locally on IndoGram."
      });
    }

    const apiId = Number(apiIdStr);
    if (isNaN(apiId)) {
      return res.status(400).json({ error: "Invalid API ID format. Must be a numeric identifier." });
    }

    // Disconnect existing active connection for this phone to prevent leaks
    const existingClient = activeTelegramClients.get(phone);
    if (existingClient) {
      try {
        await existingClient.disconnect();
      } catch (_) {}
      activeTelegramClients.delete(phone);
    }

    console.log(`[MTProto Server] Initiating active client connect sequence for phone: ${phone}...`);
    const client = new TelegramClient(new StringSession(""), apiId, apiHashStr, {
      connectionRetries: 5,
    });
    
    // Set _loopStarted to true to completely bypass GramJS background updates loop (which is prone to timeouts under container/sandboxes)
    (client as any)._loopStarted = true;

    await client.connect();

    console.log(`[MTProto Server] Triggering real-time auth.sendCode call...`);
    const { phoneCodeHash } = await client.sendCode(
      {
        apiId,
        apiHash: apiHashStr,
      },
      phone
    );

    // Save client instance and active hash state
    activeTelegramClients.set(phone, client);
    activeTelegramHashes.set(phone, phoneCodeHash);

    console.log(`[MTProto Server] Success! Real OTP has been dispatched to phone: ${phone}`);
    return res.json({
      success: true,
      message: "API auth code successfully requested from Telegram!",
      phoneCodeHash,
    });
  } catch (err: any) {
    console.error("[MTProto Server Error] Failed to send Telegram OTP Code:", err);
    return res.json({
      success: false,
      error: err.message || "Failed to dispatch verification code via MTProto broker."
    });
  }
});

// Real Telegram MTProto OTP Verify and Auth Session Complete
app.post("/api/telegram/verify-code", async (req, res) => {
  try {
    const { phone, code, apiId: customApiId, apiHash: customApiHash } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: "Missing required parameters phone or validation code." });
    }

    const client = activeTelegramClients.get(phone);
    const phoneCodeHash = activeTelegramHashes.get(phone);

    if (!client || !phoneCodeHash) {
      return res.json({
        success: false,
        error: "session_expired",
        message: "Verification session expired or does not exist. Please trigger a new OTP code send."
      });
    }

    const apiIdStr = customApiId || process.env.VITE_TELEGRAM_API_ID;
    const apiHashStr = customApiHash || process.env.VITE_TELEGRAM_API_HASH;

    console.log(`[MTProto Server] Directing client.signIn authentication attempt for ${phone}...`);
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );

    // Save authenticated connection Session string
    const stringSession = (client.session.save() as unknown) as string;

    // Optional grab of current profile to populate local app database
    let me: any = null;
    try {
      me = await client.getMe();
    } catch (meError) {
      console.warn("Could not retrieve me profile info in current environment:", meError);
    }

    // Disconnect active client from server memory since state is loaded by stringSession
    try {
      await client.disconnect();
    } catch (_) {}
    activeTelegramClients.delete(phone);
    activeTelegramHashes.delete(phone);

    console.log(`[MTProto Server] Login successful for user: ${phone}`);
    return res.json({
      success: true,
      message: "Authentication with Telegram verified!",
      sessionString: stringSession,
      user: me ? {
        id: me.id?.toString() || "",
        firstName: me.firstName || "",
        lastName: me.lastName || "",
        username: me.username || "",
        phone: me.phone || phone,
      } : { phone }
    });
  } catch (err: any) {
    console.error("[MTProto Server Error] Authentication sign-in failed:", err);
    return res.json({
      success: false,
      error: err.message || "Invalid or expired verification code."
    });
  }
});

// Helper to instantiate temporary live MTProto Telegram Client safely
async function getTelegramClient(sessionString: string): Promise<TelegramClient> {
  const apiIdStr = process.env.VITE_TELEGRAM_API_ID || "2040";
  const apiHashStr = process.env.VITE_TELEGRAM_API_HASH || "indogram_sandbox_hash";
  const apiId = Number(apiIdStr);

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHashStr, {
    connectionRetries: 3,
  });
  
  (client as any)._loopStarted = true;
  await client.connect();
  return client;
}

// Helper to identify if a peer ID is a mock/local-only target and shouldn't call GramJS
function isMockPeer(peerId: any): boolean {
  if (!peerId) return true;
  const peerStr = String(peerId).trim();
  
  const mockList = [
    "tg_news_channel", "indo_ai_bot", "indo_dev_group", "pavel_durov", "indo_support",
    "user_durov", "user_alice", "user_nikolai", "user_elena", "user_viktor", "user_clara",
    "indogram_news", "indogram_devs", "ai_chat"
  ];
  if (mockList.includes(peerStr)) return true;
  
  if (peerStr.startsWith("user_") || peerStr.startsWith("msg_") || peerStr.startsWith("mock_") || peerStr.startsWith("gx_")) {
    return true;
  }
  
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(peerStr)) {
    return true;
  }

  return false;
}

// Convert numeric string to appropriate types for GramJS, falling back to string
function prepareTelegramPeer(peerId: any): any {
  if (!peerId) return peerId;
  const peerStr = String(peerId).trim();
  
  if (/^-?\d+$/.test(peerStr)) {
    try {
      return BigInt(peerStr);
    } catch {
      return Number(peerStr);
    }
  }
  
  return peerStr;
}

// 0. Download Profile Avatar Endpoint
app.get("/api/telegram/avatar/:id", async (req, res) => {
  const { id } = req.params;
  const sessionString = (req.query.session as string) || req.headers.authorization;

  if (!sessionString) {
    return res.status(400).send("Session string is required as query param ?session=<string>");
  }

  try {
    const client = await getTelegramClient(sessionString);
    const cleanPeer = prepareTelegramPeer(id);
    const buffer = await client.downloadProfilePhoto(cleanPeer);
    await client.disconnect();

    if (buffer) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache inside client browser for 24h
      return res.end(buffer);
    } else {
      return res.status(404).send("No profile icon found");
    }
  } catch (err: any) {
    console.warn(`[MTProto Avatar Download Warning for peer ${id}]:`, err.message);
    return res.status(404).send("Fallback image placeholder needed");
  }
});

// Download Message Media Endpoint
app.get("/api/telegram/media/:peerId/:messageId", async (req, res) => {
  const { peerId, messageId } = req.params;
  const sessionString = (req.query.session as string) || req.headers.authorization;

  if (!sessionString) {
    return res.status(400).send("Session string is required");
  }

  try {
    const client = await getTelegramClient(sessionString);
    const cleanPeer = prepareTelegramPeer(peerId);
    
    // Get the specific message
    const messages = await client.getMessages(cleanPeer, { ids: [parseInt(messageId)] });
    if (!messages || messages.length === 0) {
      await client.disconnect();
      return res.status(404).send("Message not found");
    }

    const m = messages[0];
    if (!m.media) {
      await client.disconnect();
      return res.status(400).send("Message has no media");
    }

    // Determine the mime type to set correct headers
    let contentType = "application/octet-stream";
    const mediaAny = m.media as any;
    const className = mediaAny.className || mediaAny.constructor?.name;
    if (className === "MessageMediaPhoto" || mediaAny.photo) {
      contentType = "image/jpeg";
    } else if (className === "MessageMediaDocument" || mediaAny.document) {
      contentType = mediaAny.document.mimeType || "application/octet-stream";
    }

    // Download the media to a buffer
    const buffer = await client.downloadMedia(m.media);
    await client.disconnect();

    if (buffer) {
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400"); // Cache inside client browser for 24h
      return res.end(buffer);
    } else {
      return res.status(404).send("Failed to download media");
    }
  } catch (err: any) {
    console.warn(`[MTProto Media Download Warning for peer ${peerId}, msg ${messageId}]:`, err.message);
    return res.status(404).send("Failed to retrieve media");
  }
});

// 1. Get Live Dialogs / Conversations
app.post("/api/telegram/get-dialogs", async (req, res) => {
  const { sessionString } = req.body;
  if (!sessionString) {
    return res.status(400).json({ error: "Session string is required" });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const dialogs = await client.getDialogs({ limit: 40 });
    
    const formatted = dialogs.map((d: any) => {
      const id = d.id?.toString() || "";
      const name = d.name || "Telegram User";
      const unreadCount = d.unreadCount || 0;
      
      let lastMsg = d.message?.message || "";
      if (!lastMsg && d.message) {
        let actionDesc = "";
        if (d.message.action) {
          const className = d.message.action.className || d.message.action.constructor?.name || "";
          if (className.includes("ContactSignUp")) {
            actionDesc = "joined Telegram";
          } else if (className.includes("ChatAddUser") || className.includes("ChatJoinedByLink")) {
            actionDesc = "joined the group";
          } else if (className.includes("ChatCreate")) {
            actionDesc = "created the group";
          } else if (className.includes("PinMessage") || className.includes("Pinned")) {
            actionDesc = "pinned a message";
          } else {
            actionDesc = "performed a service action";
          }
        }
        
        if (actionDesc) {
          const sName = d.message.sender 
            ? `${d.message.sender.firstName || ""} ${d.message.sender.lastName || ""}`.trim() || d.message.sender.username || ""
            : "";
          lastMsg = sName ? `${sName} ${actionDesc}` : actionDesc;
        } else {
          lastMsg = "No messages";
        }
      }

      const lastMsgAt = d.message?.date ? new Date(d.message.date * 1000).toISOString() : new Date().toISOString();
      const isOnline = false;
      const isGroup = d.isGroup || d.isChannel;
      
      return {
        id,
        type: isGroup ? 'group' : 'direct',
        otherUserId: id,
        user: name,
        username: d.peer?.username || "",
        fullName: name,
        lastMsg,
        lastMsgAt,
        time: d.message?.date ? new Date(d.message.date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "",
        avatar: d.peer?.photo ? `/api/telegram/avatar/${id}?session=${encodeURIComponent(sessionString)}` : `https://images.unsplash.com/photo-1542751371-adc38448a05e?w=150`,
        unread: unreadCount > 0,
        unreadCount,
        isOnline,
        lastMsgStatus: 'Received'
      };
    });

    await client.disconnect();
    return res.json({ success: true, conversations: formatted });
  } catch (err: any) {
    console.warn("[MTProto Server] Failing gracefully getting dialogs:", err.message);
    return res.json({ success: true, conversations: [], error: err.message });
  }
});

// 2. Get Live Messages for Peer
app.post("/api/telegram/get-messages", async (req, res) => {
  const { sessionString, peerId, limit = 50 } = req.body;
  if (!sessionString || !peerId) {
    return res.status(400).json({ error: "Session string and peerId are required" });
  }

  // Gracefully skip calling MTProto if it's a local/mock peer
  if (isMockPeer(peerId)) {
    console.log(`[MTProto Server] Bypassing get-messages API call for mock peer target: ${peerId}`);
    return res.json({ success: true, messages: [] });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const cleanPeer = prepareTelegramPeer(peerId);
    const messages = await client.getMessages(cleanPeer, { limit });
    
    const formatted = messages.map((m: any) => {
      const actualSenderId = m.senderId?.toString() || m.fromId?.toString() || "";
      const senderId = m.out ? "me" : actualSenderId;
      const firstName = m.sender?.firstName || "";
      const lastName = m.sender?.lastName || "";
      const displayName = (firstName + " " + lastName).trim() || m.sender?.username || "Telegram User";
      
      let mediaUrl = null;
      let mediaType = null;
      
      if (m.media) {
        const mediaAny = m.media as any;
        const className = mediaAny.className || mediaAny.constructor?.name;
        if (className === "MessageMediaPhoto" || mediaAny.photo) {
          mediaType = "image";
          mediaUrl = `/api/telegram/media/${encodeURIComponent(peerId)}/${m.id}?session=${encodeURIComponent(sessionString)}`;
        } else if (className === "MessageMediaDocument" || mediaAny.document) {
          const mime = mediaAny.document?.mimeType || "";
          if (mime.startsWith("image/")) {
            mediaType = "image";
          } else if (mime.startsWith("video/")) {
            mediaType = "video";
          } else if (mime.startsWith("audio/") || mime === "application/ogg") {
            mediaType = mime.includes("voice") ? "voice" : "audio";
          } else {
            mediaType = "file";
          }
          mediaUrl = `/api/telegram/media/${encodeURIComponent(peerId)}/${m.id}?session=${encodeURIComponent(sessionString)}`;
        } else if (className === "MessageMediaGeo" || className === "MessageMediaGeoLive" || mediaAny.geo) {
          mediaType = "location";
        }
      }

      let replyToMsgId = null;
      if (m.replyTo) {
        const r = m.replyTo as any;
        replyToMsgId = r.replyToMsgId || r.replyToHeader?.replyToMsgId;
      } else if ((m as any).replyToHeader) {
        replyToMsgId = (m as any).replyToHeader.replyToMsgId;
      }

      return {
        id: m.id?.toString() || `msg_${Date.now()}_${Math.random()}`,
        text: m.message || "",
        created_at: new Date(m.date * 1000).toISOString(),
        sender_id: senderId,
        sender_name: displayName,
        senderName: displayName,
        avatar: m.sender?.photo ? `/api/telegram/avatar/${senderId}?session=${encodeURIComponent(sessionString)}` : `https://images.unsplash.com/photo-1542751371-adc38448a05e?w=50`,
        media_url: mediaUrl,
        media_type: mediaType,
        reply_to: replyToMsgId ? replyToMsgId.toString() : null
      };
    });

    await client.disconnect();
    return res.json({ success: true, messages: formatted });
  } catch (err: any) {
    console.warn(`[MTProto Server] Bypassing get-messages failure for peer ${peerId}:`, err.message);
    return res.json({ success: true, messages: [], error: err.message });
  }
});

// 3. Send Live Message
app.post("/api/telegram/send-message", async (req, res) => {
  const { sessionString, peerId, message, mediaUrl, mediaType, replyToMsgId } = req.body;
  if (!sessionString || !peerId || (!message && !mediaUrl)) {
    return res.status(400).json({ error: "Session string, peerId and either message or mediaUrl are required" });
  }

  if (isMockPeer(peerId)) {
    console.log(`[MTProto Server] Intercepting mock peer target send-message call for: ${peerId}`);
    return res.json({
      success: true,
      message: {
        id: `mock_msg_${Date.now()}`,
        text: message || "",
        created_at: new Date().toISOString(),
        sender_id: "me",
        sender_name: "Me",
        media_url: mediaUrl || null,
        media_type: mediaType || null,
        reply_to: replyToMsgId || null,
      }
    });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const cleanPeer = prepareTelegramPeer(peerId);
    let sent;

    const parsedReplyTo = replyToMsgId ? parseInt(replyToMsgId) : undefined;

    if (mediaUrl) {
      let fileToUpload: any = mediaUrl;
      if (mediaUrl.startsWith('http')) {
        try {
          const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
          fileToUpload = Buffer.from(response.data);
          // Attach dummy name with the correct extension so GramJS is happy
          const ext = mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : mediaType === 'voice' ? 'ogg' : 'bin';
          (fileToUpload as any).name = `file.${ext}`;
        } catch (err) {
          console.error('[MTProto] Failed to pre-fetch media URL buffer:', err);
        }
      }
      sent = await client.sendFile(cleanPeer, {
        file: fileToUpload,
        caption: message || "",
        replyTo: parsedReplyTo,
      });
    } else {
      sent = await client.sendMessage(cleanPeer, { 
        message,
        replyTo: parsedReplyTo,
      });
    }
    
    const msgObj = Array.isArray(sent) ? sent[0] : sent;
    const formatted = {
      id: msgObj?.id?.toString() || `msg_${Date.now()}`,
      text: msgObj?.message || message || "",
      created_at: msgObj?.date ? new Date(msgObj.date * 1000).toISOString() : new Date().toISOString(),
      sender_id: "me",
      sender_name: "Me",
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      reply_to: replyToMsgId || null,
    };

    await client.disconnect();
    return res.json({ success: true, message: formatted });
  } catch (err: any) {
    console.warn(`[MTProto Server] Bypassing send-message failure for peer ${peerId}:`, err.message);
    return res.json({
      success: true,
      message: {
        id: `failed_fallback_msg_${Date.now()}`,
        text: message || "",
        created_at: new Date().toISOString(),
        sender_id: "me",
        sender_name: "Me",
        media_url: mediaUrl || null,
        media_type: mediaType || null,
        reply_to: replyToMsgId || null,
        deliveryFailed: true,
      },
      error: err.message
    });
  }
});

// 4. Delete Live Message
app.post("/api/telegram/delete-message", async (req, res) => {
  const { sessionString, peerId, messageId } = req.body;
  if (!sessionString || !peerId || !messageId) {
    return res.status(400).json({ error: "Session string, peerId and messageId are required" });
  }

  if (isMockPeer(peerId)) {
    return res.json({ success: true });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const cleanPeer = prepareTelegramPeer(peerId);
    const msgIdNum = Number(messageId);
    await client.deleteMessages(cleanPeer, [msgIdNum], { revoke: true });

    await client.disconnect();
    return res.json({ success: true });
  } catch (err: any) {
    console.warn(`[MTProto Server] Delete message exception bypassed for peer ${peerId}:`, err.message);
    return res.json({ success: true, error: err.message });
  }
});

// 5. Edit Live Message
app.post("/api/telegram/edit-message", async (req, res) => {
  const { sessionString, peerId, messageId, text } = req.body;
  if (!sessionString || !peerId || !messageId || !text) {
    return res.status(400).json({ error: "sessionString, peerId, messageId, and text are required" });
  }

  if (isMockPeer(peerId)) {
    return res.json({ success: true });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const cleanPeer = prepareTelegramPeer(peerId);
    const msgIdNum = Number(messageId);
    await client.editMessage(cleanPeer, { message: msgIdNum, text });

    await client.disconnect();
    return res.json({ success: true });
  } catch (err: any) {
    console.warn(`[MTProto Server] Edit message exception bypassed for peer ${peerId}:`, err.message);
    return res.json({ success: true, error: err.message });
  }
});

// 6. Global Search for Users
app.post("/api/telegram/search-global", async (req, res) => {
  const { sessionString, query } = req.body;
  if (!sessionString || !query) {
    return res.status(400).json({ error: "Session string and query are required" });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const result = await client.invoke(
      new Api.contacts.Search({
        q: query,
        limit: 20
      })
    );

    const users = (result.users || []).map((u: any) => {
      const id = u.id?.toString() || "";
      const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username || "Telegram User";
      return {
        id,
        email: `${u.username || id}@indogram.org`,
        username: u.username || "",
        full_name: name,
        bio: u.about || "Telegram User",
        photo_url: `https://images.unsplash.com/photo-1542751371-adc38448a05e?w=150`,
        status: u.status?._ === 'userStatusOnline' ? 'online' : 'offline',
        is_online: u.status?._ === 'userStatusOnline'
      };
    });

    await client.disconnect();
    return res.json({ success: true, users });
  } catch (err: any) {
    console.error("[MTProto Server] Error searching global users:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get Live Call Logs from Telegram
app.post("/api/telegram/get-calls", async (req, res) => {
  const { sessionString, limit = 50 } = req.body;
  if (!sessionString) {
    return res.status(400).json({ error: "Session string is required" });
  }

  try {
    const client = await getTelegramClient(sessionString);
    const result: any = await client.invoke(
      new Api.messages.Search({
        peer: new Api.InputPeerEmpty(),
        q: "",
        filter: new Api.InputMessagesFilterPhoneCalls({}),
        minDate: 0,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit: limit,
        maxId: 0,
        minId: 0,
        hash: BigInt(0) as any,
      })
    );

    const callList: any[] = [];
    if (result && result.messages) {
      const usersMap = new Map<string, any>();
      if (result.users && Array.isArray(result.users)) {
        result.users.forEach((u: any) => {
          usersMap.set(u.id?.toString(), u);
        });
      }

      result.messages.forEach((m: any) => {
        // Only care about messages with call actions
        let isCall = false;
        if (m.action && m.action.className && m.action.className.includes("PhoneCall")) {
          isCall = true;
        } else {
          const actName = m.action?.constructor?.name || "";
          if (actName.includes("PhoneCall") || actName.includes("Phone")) {
            isCall = true;
          }
        }
        if (!isCall) return;

        const isOutgoing = m.out || false;
        // Find other participant's user ID
        let otherUserId = "";
        if (m.peerId && m.peerId.userId) {
          otherUserId = m.peerId.userId.toString();
        } else if (m.fromId && m.fromId.userId) {
          otherUserId = m.fromId.userId.toString();
        } else if (m.senderId) {
          otherUserId = m.senderId.toString();
        }

        if (!otherUserId) return;

        const userObj = usersMap.get(otherUserId);
        const firstName = userObj?.firstName || "";
        const lastName = userObj?.lastName || "";
        const displayName = (firstName + " " + lastName).trim() || userObj?.username || "Telegram User";
        const avatar = userObj?.photo ? `/api/telegram/avatar/${otherUserId}?session=${encodeURIComponent(sessionString)}` : `https://images.unsplash.com/photo-1542751371-adc38448a05e?w=50`;

        const isVideo = m.action?.video || false;
        const isMissed = m.action?.reason?.className?.toLowerCase().includes("missed") || false;

        callList.push({
          id: m.id?.toString() || `call_${Date.now()}_${Math.random()}`,
          otherUserId,
          user: displayName,
          avatar,
          type: isVideo ? 'video' : 'voice',
          isIncoming: !isOutgoing,
          isMissed,
          time: m.date ? new Date(m.date * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : new Date().toLocaleString()
        });
      });
    }

    await client.disconnect();
    return res.json({ success: true, callList });
  } catch (err: any) {
    console.warn("[MTProto Server] get-calls fallback warning:", err.message);
    // Return empty array on failure/unsupported instead of crashing
    return res.json({ success: true, callList: [] });
  }
});

// LiveKit Token generation endpoint
app.post("/api/livekit-token", async (req, res) => {
  try {
    const { roomName, participantIdentity } = req.body;
    if (!roomName || !participantIdentity) {
      return res.status(400).json({ error: "Missing roomName or participantIdentity parameters" });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.warn("FCM Server: LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing. Proceeding with standard sandbox mock tokens.");
      return res.json({
        success: false,
        error: "LiveKit server credentials are not configured. Please define LIVEKIT_API_KEY and LIVEKIT_API_SECRET in settings.",
        token: "mock-livekit-token-sandbox"
      });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return res.json({ success: true, token });
  } catch (error: any) {
    console.error("LiveKit token generation exception:", error);
    return res.status(500).json({ error: error.message || "Failed to generate LiveKit token" });
  }
});

// Sitemap route for SEO
app.get("/sitemap.xml", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://indogram.gothwad.workers.dev/</loc><priority>1.0</priority><changefreq>daily</changefreq></url>
  <url><loc>https://indogram.gothwad.workers.dev/tools</loc><priority>0.8</priority><changefreq>weekly</changefreq></url>
  <url><loc>https://indogram.gothwad.workers.dev/chats</loc><priority>0.9</priority><changefreq>always</changefreq></url>
  <url><loc>https://indogram.gothwad.workers.dev/reels</loc><priority>0.8</priority><changefreq>always</changefreq></url>
</urlset>`);
});

// Digital Asset Links for Android PWA/TWA verification
app.get("/.well-known/assetlinks.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const assetlinksPath = fs.existsSync(path.resolve(process.cwd(), "dist/.well-known/assetlinks.json"))
    ? path.resolve(process.cwd(), "dist/.well-known/assetlinks.json")
    : path.resolve(process.cwd(), "public/.well-known/assetlinks.json");

  if (fs.existsSync(assetlinksPath)) {
    res.sendFile(assetlinksPath);
  } else {
    // Graceful fallback with standard placeholders matching the public file
    res.json([
      {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
          "namespace": "android_app",
          "package_name": "com.gothwad.indogram",
          "sha256_cert_fingerprints": [
            "F1:A1:DA:3C:A9:74:9C:13:B9:92:EF:CD:AA:E1:92:BB:D4:57:3E:04:9E:FC:D7:E5:A9:DF:11:80:FF:E3:A3:AA"
          ]
        }
      }
    ]);
  }
});

// Helper to remove invalid/expired FCM tokens from the user profile database
async function removeInvalidFcmToken(badTokenStr: string) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn("FCM Server Cleanup: Unable to initialize Supabase client for FCM token cleanup (missing credentials).");
    return;
  }
  
  try {
    const supabaseServer = createClient(supabaseUrl, supabaseKey);
    
    // Find all users who have this token in their fcm_tokens array and remove it
    const { data: users, error: fetchErr } = await supabaseServer
      .from("users")
      .select("id, fcm_tokens");
      
    if (fetchErr || !users) {
      console.warn("FCM Server Cleanup: Failed to fetch users for token pruning:", fetchErr);
      return;
    }

    for (const u of users) {
      if (Array.isArray(u.fcm_tokens) && u.fcm_tokens.includes(badTokenStr)) {
        const filtered = u.fcm_tokens.filter((t: string) => t !== badTokenStr);
        console.log(`FCM Server Cleanup: Removing stale/invalid FCM token from user ${u.id}`);
        const { error: updateErr } = await supabaseServer
          .from("users")
          .update({ fcm_tokens: filtered })
          .eq("id", u.id);
          
        if (updateErr) {
          console.warn(`FCM Server Cleanup: Failed to update user ${u.id} FCM tokens:`, updateErr);
        }
      }
    }
  } catch (err: any) {
    console.warn("FCM Server Cleanup: Exception in removeInvalidFcmToken:", err.message);
  }
}

// Send Notification Proxy using Firebase Cloud Messaging HTTP v1 API
app.post("/api/send-notification", async (req, res) => {
  try {
    if (!req.body) {
      return res.status(400).json({ error: "Missing request body" });
    }
    const { tokens, title, body, data } = req.body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: "Missing recipient registration tokens" });
    }

    // Ensure all tokens are valid non-empty strings
    const validTokens = tokens.filter(t => typeof t === 'string' && t.trim().length > 0);
    if (validTokens.length === 0) {
      return res.status(400).json({ error: "No valid recipient registration tokens provided" });
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      console.warn("FCM Server: FIREBASE_SERVICE_ACCOUNT variable not set. Simulating push notification dispatch in terminal logs.");
      console.log(`[PUSH NOTIFICATION SIMULATION]`);
      console.log(`Title: ${title}`);
      console.log(`Body: ${body}`);
      console.log(`Tokens:`, validTokens);
      return res.json({ 
        success: true, 
        simulated: true, 
        message: "Push simulate successful. Configure FIREBASE_SERVICE_ACCOUNT in env to enable active Google FCM sending." 
      });
    }

    let credentials: any;
    try {
      credentials = JSON.parse(serviceAccountJson);
      if (typeof credentials === 'string') {
        credentials = JSON.parse(credentials);
      }
    } catch (parseErr: any) {
      console.error("FCM Server: Failed to parse FIREBASE_SERVICE_ACCOUNT env value:", parseErr);
      return res.status(500).json({ error: `FIREBASE_SERVICE_ACCOUNT JSON parse failure: ${parseErr.message}` });
    }

    const projectId = credentials?.project_id;
    if (!projectId) {
      throw new Error("project_id missing from FIREBASE_SERVICE_ACCOUNT credentials");
    }

    // Automatically heal literal '\n' sequences in the private key if stored as an escaped string
    if (credentials.private_key && typeof credentials.private_key === 'string') {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    // Authenticate with Google APIs scope for Firebase Cloud Messaging
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const client = await auth.getClient();
    const accessTokenObj = await client.getAccessToken();
    const accessToken = accessTokenObj.token;
    if (!accessToken) {
      throw new Error("Failed to retrieve Google Access Token for FCM scope");
    }

    console.log(`FCM Server: Dispatching push alerts to ${validTokens.length} registration tokens.`);
    const results = await Promise.all(
      validTokens.map(async (token) => {
        try {
          const payload = {
            message: {
              token,
              notification: { title, body },
              data: {
                click_action: data?.click_action || '/chats',
                conversationId: data?.conversationId || '',
                senderId: data?.senderId || '',
                ...(data || {})
              }
            }
          };

          const response = await axios.post(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            payload,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
          return { token, success: true, messageId: response.data?.name };
        } catch (err: any) {
          const safeTokenStr = (typeof token === 'string') ? token.substring(0, 10) : String(token);
          console.error(`FCM Server: Failed to send to token: ${safeTokenStr}... Error:`, err.response?.data || err.message);
          
          const isInvalidToken = 
            err.response?.status === 400 || 
            err.response?.status === 404 ||
            (err.response?.data?.error?.status === 'INVALID_ARGUMENT') ||
            (err.response?.data?.error?.status === 'NOT_FOUND') ||
            (err.response?.data?.error?.status === 'UNREGISTERED') ||
            (err.response?.data?.error?.message && (
              err.response.data.error.message.includes('not a valid FCM registration token') ||
              err.response.data.error.message.includes('Requested entity was not found')
            ));

          if (isInvalidToken) {
            removeInvalidFcmToken(token).catch(e => {
              console.error("FCM Token Cleanup trigger failed:", e);
            });
          }

          return { token, success: false, error: err.response?.data || err.message };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      total: validTokens.length,
      sentCount: successCount,
      results
    });
  } catch (error: any) {
    console.error("FCM Send Notification failed:", error);
    res.status(500).json({ error: error.message || "Failed to process push dispatch" });
  }
});

// Secure Server-side Gemini AI Completion Proxy (IndoAI)
app.post("/api/indo-ai", async (req, res) => {
  const { messages, model, modelType } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Server IndoAI Proxy: GEMINI_API_KEY not found in environment.");
    return res.status(400).json({ 
      error: "Gemini API key is not configured on the server. Please register GEMINI_API_KEY in server environment settings." 
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const formattedMessages = Array.isArray(messages) ? messages : [];
    
    // Extract system instruction
    const systemMsg = formattedMessages.find(m => m.role === "system");
    const systemInstruction = systemMsg ? (systemMsg.content || systemMsg.text) : "You are Indo AI, a helpful and friendly assistant for IndoGram.";

    // Format thread to Gemini dynamic-contents array
    const conversationContents = formattedMessages
      .filter(m => m.role !== "system")
      .map(m => {
        const role = (m.role === "assistant" || m.role === "model") ? "model" : "user";
        return {
          role,
          parts: [{ text: m.content || m.text || "" }]
        };
      });

    const mType = model || modelType || 'indo-ai';
    const modelId = "gemini-3.5-flash"; // Active, highly performant, free-tier model

    const response = await ai.models.generateContent({
      model: modelId,
      contents: conversationContents,
      config: {
        systemInstruction,
        temperature: mType === 'indo-ai-pro' ? 1.0 : 0.7,
      }
    });

    const reply = response.text || "I'm sorry, I couldn't process that.";
    res.json({ success: true, reply });
  } catch (error: any) {
    console.error("Server IndoAI SDK Error:", error);
    res.status(500).json({ 
      error: error.message || "An error occurred while communicating with Gemini." 
    });
  }
});

// File Upload Proxy (Catbox for images/videos, Gofile.io for others)
app.post("/api/upload-file", (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ status: 'error', message: `Multer error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ status: 'error', message: `Unknown upload error: ${err.message}` });
    }
    next();
  });
}, async (req: any, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  const isMedia = req.file.mimetype.startsWith('image/') || req.file.mimetype.startsWith('video/');

  try {
    if (isMedia) {
      // Upload to Catbox.moe
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      console.log('Uploading media to Catbox.moe...');
      const response = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 60000,
      });

      if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.json({ 
          status: 'ok', 
          downloadUrl: response.data.trim(),
          provider: 'catbox'
        });
      }
      throw new Error(`Catbox error: ${response.data}`);
    } else {
      // Upload to Gofile.io
      // 1. Get best server
      console.log('Getting Gofile server...');
      const serverRes = await axios.get('https://api.gofile.io/getServer');
      const server = serverRes.data.data.server;

      // 2. Upload
      const form = new FormData();
      form.append('file', fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      console.log(`Uploading file to Gofile server: ${server}...`);
      const response = await axios.post(`https://${server}.gofile.io/contents/uploadfile`, form, {
        headers: form.getHeaders(),
        timeout: 120000, // Gofile can be slow for large files
      });

      if (response.data && response.data.status === 'ok') {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.json({ 
          status: 'ok', 
          downloadUrl: response.data.data.downloadPage, // Note: Direct link might require premium for Gofile, so we give download page
          fileId: response.data.data.fileId,
          provider: 'gofile'
        });
      }
      throw new Error(`Gofile error: ${JSON.stringify(response.data)}`);
    }
  } catch (error: any) {
    console.error('Upload failed:', error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ status: 'error', message: `Upload failed: ${error.message}` });
  }
});

// Debug endpoint
app.get("/api/github/debug", (req, res) => {
  res.json({
    hasClientId: !!GITHUB_CLIENT_ID,
    hasClientSecret: !!GITHUB_CLIENT_SECRET,
    appUrl: process.env.APP_URL || "Not Set",
    platform: "Cloudflare/GCP",
    env: process.env.NODE_ENV
  });
});

// GitHub Auth URL
app.get("/api/github/auth-url", (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    console.error("GITHUB_CLIENT_ID is missing from environment variables.");
    return res.status(500).json({ error: "GITHUB_CLIENT_ID is not set" });
  }
  
  // Better fallback logic for APP_URL
  let appUrl = process.env.APP_URL;
  
  // If APP_URL is missing or looks like a placeholder, try to derive it
  if (!appUrl || !appUrl.startsWith('http')) {
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    appUrl = `${protocol}://${host}`;
    console.log(`Derived APP_URL from request: ${appUrl}`);
  }
  
  // Ensure appUrl doesn't end with a slash for consistency
  appUrl = appUrl.replace(/\/$/, "");
  
  const redirectUri = `${appUrl}/auth/github/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user,workflow&state=${Math.random().toString(36).substring(7)}`;
  
  console.log(`Generated GitHub Auth URL: ${url}`);
  console.log(`Using Redirect URI: ${redirectUri}`);
  
  res.json({ url, redirectUri });
});

// GitHub Callback
app.get(["/auth/github/callback", "/auth/github/callback/"], async (req, res) => {
  const { code } = req.query;
  console.log(`GitHub Callback received with code: ${code ? 'PRESENT' : 'MISSING'}`);
  
  try {
    const response = await axios.post("https://github.com/login/oauth/access_token", {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }, {
      headers: { Accept: "application/json" }
    });

    const accessToken = response.data.access_token;
    if (!accessToken) {
      console.error("Failed to obtain access token from GitHub:", response.data);
      throw new Error("No access token");
    }

    console.log("GitHub Access Token obtained successfully.");

    res.send(`
      <html>
        <head>
          <title>Authenticating...</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="margin:0; background:#f4f4f5;">
          <script>
            const token = '${accessToken}';
            try {
              localStorage.setItem('github_token', token);
            } catch (e) {
              console.error("Local storage error:", e);
            }

            const message = { type: 'GITHUB_AUTH_SUCCESS', token: token };
            
            if (window.opener) {
              window.opener.postMessage(message, '*');
              // Close after a short delay to ensure message is sent
              setTimeout(() => {
                window.close();
                // Fallback if window.close() is blocked
                document.getElementById('status').innerText = 'Authenticated! You can close this window.';
              }, 500);
            } else {
              // If no opener, don't just redirect inside the popup as it fails outside iframe
              document.getElementById('status').innerText = 'Authenticated! Please return to IndoGram.';
              document.getElementById('loader').style.display = 'none';
              document.getElementById('success-icon').style.display = 'block';
            }
          </script>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;text-align:center;">
            <div id="loader" style="width:48px;height:48px;border:4px solid #e4e4e7;border-top-color:#0494f4;border-radius:50%;animation:spin 1s linear infinite;"></div>
            <div id="success-icon" style="display:none;width:60px;height:60px;background:#0494f4;border-radius:50%;color:white;display:none;align-items:center;justify-content:center;font-size:30px;margin-bottom:20px;">✓</div>
            <p id="status" style="margin-top:24px;font-weight:600;color:#18181b;font-size:16px;">Authenticating with GitHub...</p>
            <p style="margin-top:8px;color:#71717a;font-size:14px;">Securely connecting your accounts</p>
          </div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            #success-icon { display: none; }
          </style>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send("Auth failed");
  }
});

// GitHub Push
app.post("/api/github/push", async (req, res) => {
  const { token, owner, repo, path: filePath, content, message, branch = 'main' } = req.body;
  try {
    let sha;
    try {
      const getFileRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Authorization: `token ${token}` }
      });
      sha = getFileRes.data.sha;
    } catch (e) {}

    const pushRes = await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      message, content, sha, branch
    }, {
      headers: { Authorization: `token ${token}` }
    });
    res.json(pushRes.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
  }
});

import crypto from "crypto";

// Helper to calculate GitHub's blob SHA
function calculateGitHubSha(contentBase64: string): string {
  const content = Buffer.from(contentBase64, 'base64');
  const header = `blob ${content.length}\0`;
  const store = Buffer.concat([Buffer.from(header), content]);
  return crypto.createHash('sha1').update(store).digest('hex');
}

// GitHub Batch Push (Atomic commit for multiple files)
app.post("/api/github/push-batch", async (req, res) => {
  const { token, owner, repo, files, message, branch = 'main', isSequential = false } = req.body;
  
  try {
    const headers = { 
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json'
    };

    console.log(`Starting smart batch push for ${files.length} files to ${owner}/${repo} on branch ${branch} [isSequential: ${isSequential}]`);

    // 1. Get the latest commit SHA of the branch
    const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, { headers });
    const parentSha = branchRes.data.commit.sha;
    const baseTreeSha = branchRes.data.commit.commit.tree.sha;

    // 2. Fetch the current recursive tree to compare SHAs
    console.log(`Fetching current tree for comparison...`);
    const existingTreeRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`, { headers });
    const existingFiles = new Map<string, string>(); // path -> sha
    if (existingTreeRes.data.tree) {
      existingTreeRes.data.tree.forEach((node: any) => {
        if (node.type === 'blob') {
          existingFiles.set(node.path, node.sha);
        }
      });
    }

    // 3. Filter files that actually changed
    const modifiedFiles = files.filter((file: any) => {
      const localSha = calculateGitHubSha(file.content);
      const remoteSha = existingFiles.get(file.path);
      return localSha !== remoteSha;
    });

    console.log(`Smart Sync: ${modifiedFiles.length} of ${files.length} files changed.`);

    if (modifiedFiles.length === 0) {
      return res.json({ 
        message: "No changes detected. Repository is already up to date.",
        noChanges: true 
      });
    }

    // If sequential mode is enabled, upload files one-by-one to support safe incrementing
    if (isSequential) {
      console.log(`Sequential Sync Mode: Uploading ${modifiedFiles.length} files individually...`);
      let uploadedCount = 0;
      
      try {
        for (let i = 0; i < modifiedFiles.length; i++) {
          const file = modifiedFiles[i];
          const sha = existingFiles.get(file.path);
          
          console.log(`Uploading file ${i + 1}/${modifiedFiles.length}: ${file.path} (SHA: ${sha || 'new'})`);
          
          await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
            message: `${message} - update ${file.path}`,
            content: file.content,
            sha: sha || undefined,
            branch
          }, { headers });

          uploadedCount++;
          
          // Small pause to prevent hitting GitHub's abuse detection rates on continuous fast writes
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        return res.json({
          message: `Successfully uploaded all ${uploadedCount} files sequentially.`,
          sequential: true,
          uploadedCount,
          html_url: `https://github.com/${owner}/${repo}/commits/${branch}`
        });

      } catch (err: any) {
        const errorDetail = err.response?.data?.message || err.message;
        console.error(`Sequential sync error after uploading ${uploadedCount} files:`, err.response?.data || err.message);
        
        if (uploadedCount > 0) {
          return res.json({
            message: `Uploaded ${uploadedCount} files successfully, but stopped because of GitHub limit.`,
            sequential: true,
            uploadedCount,
            error: errorDetail,
            html_url: `https://github.com/${owner}/${repo}/commits/${branch}`
          });
        } else {
          throw new Error(`Failed to upload first file ${modifiedFiles[0].path}: ${errorDetail}`);
        }
      }
    }

    // 4. Create blobs for each modified file with concurrency control
    const treeItems = [];
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 400; // ms

    for (let i = 0; i < modifiedFiles.length; i += BATCH_SIZE) {
      const batch = modifiedFiles.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(modifiedFiles.length / BATCH_SIZE)} (${batch.length} files)`);
      
      const results = await Promise.all(batch.map(async (file: any) => {
        try {
          const blobRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
            content: file.content,
            encoding: 'base64'
          }, { headers });
          
          return {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blobRes.data.sha
          };
        } catch (err: any) {
          console.error(`Failed to create blob for ${file.path}:`, err.response?.data || err.message);
          throw new Error(`Failed to upload ${file.path}: ${err.response?.data?.message || err.message}`);
        }
      }));
      
      treeItems.push(...results);
      
      if (i + BATCH_SIZE < modifiedFiles.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`Successfully created ${treeItems.length} new blobs. Creating updated tree...`);

    // 5. Create a new tree (basing it on the existing baseTreeSha to merge changes)
    const treeRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
      base_tree: baseTreeSha,
      tree: treeItems
    }, { headers });

    // 6. Create a new commit
    const commitRes = await axios.post(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: treeRes.data.sha,
      parents: [parentSha]
    }, { headers });

    // 7. Update the branch reference
    const refRes = await axios.patch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: commitRes.data.sha,
      force: false
    }, { headers });

    console.log(`Successfully updated reference for branch ${branch}`);
    res.json(refRes.data);
  } catch (error: any) {
    console.error("Smart Batch Push error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { message: error.message });
  }
});

// Retrieve list of codebase files for Sync Tool
app.get("/api/github/list-files", (req, res) => {
  const listAllFiles = (dir: string, fileList: string[] = []): string[] => {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        const baseName = path.basename(file);
        if (!baseName.startsWith('.') && baseName !== 'node_modules' && baseName !== 'dist' && baseName !== '.git' && baseName !== 'tmp') {
          listAllFiles(filePath, fileList);
        }
      } else {
        const relativePath = path.relative(process.cwd(), filePath);
        fileList.push(relativePath);
      }
    });
    return fileList;
  };
  try {
    const allFiles = listAllFiles(process.cwd());
    res.json({ files: allFiles });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Retrieve localized file content for Sync Tool
app.get("/api/github/get-file-content", (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: "Path is required" });
  
  // Normalize path to prevent directory traversal
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!resolvedPath.startsWith(process.cwd())) {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = fs.readFileSync(resolvedPath, 'base64');
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite / Static handling
if (process.env.NODE_ENV !== "production") {
  // Dynamic import for development
  import("vite").then(({ createServer }) => {
    createServer({
      server: { middlewareMode: true },
      appType: "spa",
    }).then((vite) => {
      app.use(vite.middlewares);
    });
  });
} else {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath, { dotfiles: "allow" }));
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// Start server
const PORT = 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
