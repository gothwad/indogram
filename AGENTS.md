# GrixGram Developer & AI Agent Guidelines (System Instructions)

This file contains the strict development, architectural, and design constraints for GrixGram (formerly GrixChat). As an AI Agent, you **must** read and adhere to these guidelines during every turn.

---

## 1. Core Vision & Architectural Rebrand (Welcome to GrixGram!)
* **The Mission:** We are cloning the official Telegram Web interface to build **GrixGram**, an extremely lightweight, high-performance, and feature-improved unofficial Telegram client. We maintain a pixel-perfect, beautifully polished dark cosmic visual theme while replacing all background engines with direct, native Telegram protocols.
* **Official Web Clone & Unofficial Client:** The long-term goal is for GrixGram to be the definitive premium unofficial Telegram Web client.
* **Database & Authentication Evolution:** We have systematically deprecated and removed **Supabase** and **Firebase**. All data layers, chat synchronizations, group directories, and authentications utilize direct client-side local caching (`LocalDataCache`) and secure MTProto connections directly to Telegram's gateways.
* **UI Invariance Mandate:** Unless specifically requested, the UI layout, premium animations, and dark cosmic design elements must remain **100% identical** to preserve Grix's custom aesthetics. Do not alter any layouts, styles, or page margins.

---

## 2. Platform Delivery & Cloudflare Workers Compatibility
* **Edge Runtime Compatible:** The webapp and backend will deploy onto Cloudflare Workers (relying on serverless edge V8 isolate environments rather than native Node.js VMs). All server endpoints or background systems must avoid fat Node-specific native C++ bindings, native `fs`, or non-isomorphic APIs. Every backend process must be 100% compatible with Cloudflare Workers.
* **Client-Side MTProto execution:** To scale perfectly on Cloudflare Workers without requiring stateful server sessions, execute `gramjs` directly in the user's browser, using native **Web Crypto API** and standard direct WebSocket connections to Telegram's production gateways. Store local MTProto storage sessions inside client-side `IndexedDBService`.
* **Standalone Unofficial Web Client:** GrixGram is built as a highly optimized, standalone unofficial web client for Telegram that operates fully within the browser without being a simple native web view wrapper. It integrates directly with Telegram API ID and API HASH keys for supreme performance.
* **Optimized Viewports:** Maintain dynamic height controls (`h-[100dvh]`, `pb-[safe]`) to accommodate mobile software keyboards without scrolling or header/footer jumping.
* **Micro-Animations:** Use high-velocity feedback, smooth gestures, and spring animations via `motion/react`.

---

## 3. The Telegram Client Implementation Blueprint
To implement the ultimate Telegram web-client in our full-stack Edge/React-Vite architecture, we leverage specialized solutions:
* **The MTProto Gateway (`gramjs`):** We use `gramjs` (a pure-JavaScript/TypeScript implementation of Telegram's MTProto protocol) or server-side MTProto web-sockets. This allows users to authenticate directly with their phone number and Telegram OTP, fetch active channel messages, and transact seamlessly without native C++ compilation blockages.
* **Dynamic Local Syncing (`LocalDataCache`):** Active message feeds, user presence, and drafts operate instantly from local cached tables (using our `IndexedDBService`) to maintain instant client-side performance, then synchronize asynchronously with Telegram servers.
* **Ticks Synchronization:**
  * `✓` **Single Tick (Gray):** Message uploaded to Telegram and broadcasted.
  * `✓✓` **Double Tick (Gray):** Message delivered safely to target client.
  * `✓✓` **Blue Tick:** Target client opened and read message.

---

## 4. Enterprise-Scale Feature-Based Folder Structure
Maintain the Feature-Driven Domain Architecture:
* `src/features/chat/`: Message lists, chats directories, media rendering.
* `src/features/auth/`: Clean phone number entry, OTP confirmation, and initial session creation.
* `src/features/profile/`: Telegram bios, avatars, user preferences.
* `src/components/`: Reusable dark-cosmic panels, modals, search bars, and tab frames.
* Keep sibling features isolated from each other inside `src/features/*`. Make all calls flow through robust service engines (`src/services/`).

---

## 5. Development Steps for the Transition
1. **Setup & Rebranding Phase:** Apply initial GrixGram labels, replace app assets/text headers, and configure environmental setup for `gramjs` integrating Telegram credentials securely via system environment variables (`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` in Cloudflare / AI Studio preview secrets) rather than manual client input panels.
2. **Decoupling Phase:** Safely step-by-step detach existing Supabase references and Firebase initializers, routing authentication and chat listings through local/offline placeholders until Telegram gateway session authorization is completed.
3. **MTProto SDK Middleware Setup:** Integrate `gramjs` or server-side MTProto pipelines within Express backend or client-side context to securely proxy phone sign-ins and real-time event updates.
4. **Interactive Synchronization:** Map Telegram chat conversations, group threads, and media attachments cleanly onto the current UI layout.
