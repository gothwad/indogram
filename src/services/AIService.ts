import { storage } from "./StorageService.ts";

const AI_STORAGE_KEY = 'indogram_ai_messages';
const AI_MODEL_KEY = 'indogram_ai_model';

export type AIModelType = 'indo-ai' | 'indo-ai-pro';

export interface AIMessage {
  id: string;
  text: string;
  senderId: 'user' | 'ai';
  timestamp: number;
}

class AIService {
  private currentModel: AIModelType = 'indo-ai';

  constructor() {
    const savedModel = storage.getItem(AI_MODEL_KEY) as AIModelType;
    if (savedModel && (savedModel === 'indo-ai' || savedModel === 'indo-ai-pro')) {
      this.currentModel = savedModel;
    } else if (savedModel && savedModel.startsWith('grix-')) {
      // Migrate old saved mode types nicely
      const migrated = savedModel.replace('grix-', 'indo-') as AIModelType;
      this.currentModel = migrated;
      storage.setItem(AI_MODEL_KEY, migrated);
    }
  }

  setModel(model: AIModelType) {
    this.currentModel = model;
    storage.setItem(AI_MODEL_KEY, model);
  }

  getCurrentModel(): AIModelType {
    return this.currentModel;
  }

  getMessages(): AIMessage[] {
    let stored = storage.getItem(AI_STORAGE_KEY);
    if (!stored) {
      // Migrate from old grix cache key if exists
      const oldStored = storage.getItem('grixchat_ai_messages');
      if (oldStored) {
        stored = oldStored;
        storage.setItem(AI_STORAGE_KEY, stored);
      }
    }

    if (!stored) {
      const initialMessage: AIMessage = {
        id: 'initial',
        text: 'Hello! I am Indo AI. How can I help you today?',
        senderId: 'ai',
        timestamp: Date.now()
      };
      this.saveMessages([initialMessage]);
      return [initialMessage];
    }
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error("Failed to parse AI messages:", e);
      return [];
    }
  }

  saveMessages(messages: AIMessage[]) {
    storage.setItem(AI_STORAGE_KEY, JSON.stringify(messages));
  }

  async sendMessage(text: string, extraContext?: string): Promise<string> {
    try {
      // Fetch existing conversation history (limit to last 10 messages for memory context)
      const history = this.getMessages().slice(-10);
      
      const systemInstruction = `You are ${this.currentModel === 'indo-ai-pro' ? 'Indo AI Pro' : 'Indo AI'}, a helpful and friendly assistant for IndoGram. Keep your responses concise, professional, elegant, and useful. IndoGram features premium real-time chatting, HD Reels, private codes for hidden chats, and scalable database performance. Avoid styling mentions of gradient colors. Under Indo Group India.${extraContext ? '\n' + extraContext : ''}`;

      const payloadMessages = [
        {
          role: "system",
          content: systemInstruction
        },
        ...history.map(msg => ({
          role: msg.senderId === 'user' ? 'user' : 'assistant',
          content: msg.text
        })),
        {
          role: "user",
          content: text
        }
      ];

      const response = await fetch('/api/indo-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: payloadMessages,
          modelType: this.currentModel
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Server returned non-ok response status");
      }

      const responseData = await response.json();
      return responseData.reply || "I'm sorry, I couldn't process that.";
    } catch (error: any) {
      console.error("Gemini AI Proxy Client Error:", error);
      return "I'm having some trouble connecting to Gemini. Please verify your server API key setup and try again later.";
    }
  }

  clearMessages() {
    storage.removeItem(AI_STORAGE_KEY);
  }
}

export const aiService = new AIService();
