import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

const textarea = document.querySelector(".input-container textarea");
const sendBtn = document.querySelector(".send-btn");
const messagesContainer = document.querySelector(".messages");
const modelSelector = document.getElementById("model-selector");
const screenShareBtn = document.getElementById("screen-share-btn");
const screenShareStatus = document.getElementById("screen-share-status");
const chatList = document.getElementById("chat-list");
const newChatBtn = document.getElementById("new-chat-btn");
const chatSearchInput = document.getElementById("chat-search-input");
const welcomePanel = document.getElementById("welcome-panel");
const imagePicker = document.getElementById("image-picker");
const uploadImageBtn = document.getElementById("upload-image-btn");
const attachmentTray = document.getElementById("attachment-tray");
const quickPromptCards = document.querySelectorAll("[data-prompt]");

const USER = "user";
const ASSISTANT = "assistant";
const STORAGE_KEY = "shadow-ai-sessions-v1";
const FINGERPRINT_STORAGE_KEY = "shadow-client-fingerprint-v1";
const CONTEXT_LIMIT = 12;
const THUMBMARK_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@thumbmarkjs/thumbmarkjs/dist/thumbmark.esm.js";

let csrfToken = null;
let sessions = [];
let activeSessionId = null;
let fingerprintPromise = null;

let screenStream = null;
let screenVideoTrack = null;
let captureVideo = null;
let draftAttachments = [];

let assistantSession = null;
const assistantState = {
  isAsking: false,
  output: "",
  error: "",
};

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSession(title = "New chat") {
  return {
    id: createId(),
    title,
    messages: [],
    updatedAt: Date.now(),
  };
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item && typeof item.id === "string" && Array.isArray(item.messages),
    );
  } catch {
    return [];
  }
}

function persistSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function getActiveSession() {
  return sessions.find((session) => session.id === activeSessionId) || null;
}

function getSessionById(sessionId) {
  return sessions.find((session) => session.id === sessionId) || null;
}

function getNewestSessionId() {
  if (sessions.length === 0) return null;
  return [...sessions].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  )[0].id;
}

function compactTitle(input) {
  const text = String(input || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New chat";
  return text.length <= 28 ? text : `${text.slice(0, 28)}...`;
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function renderChatList() {
  chatList.innerHTML = "";

  const filterValue = String(chatSearchInput?.value || "")
    .trim()
    .toLowerCase();

  const sorted = [...sessions].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  );
  for (const session of sorted) {
    const searchableText = [
      session.title,
      ...session.messages.map((message) => extractTextFromContent(message.content)),
    ]
      .join(" ")
      .toLowerCase();

    if (filterValue && !searchableText.includes(filterValue)) {
      continue;
    }

    const item = document.createElement("div");
    item.className = "chat-item";
    if (session.id === activeSessionId) item.classList.add("active");

    const top = document.createElement("div");
    top.className = "chat-item-top";

    const title = document.createElement("p");
    title.className = "chat-item-title";
    title.textContent = compactTitle(session.title);

    const del = document.createElement("button");
    del.className = "chat-item-delete";
    del.type = "button";
    del.textContent = "x";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSession(session.id);
    });

    top.appendChild(title);
    top.appendChild(del);

    const meta = document.createElement("div");
    meta.className = "chat-item-meta";
    meta.textContent = `${session.messages.length} msgs • ${formatDate(session.updatedAt)}`;

    item.appendChild(top);
    item.appendChild(meta);

    item.addEventListener("click", () => {
      switchSession(session.id);
    });

    chatList.appendChild(item);
  }
}

function renderMessages() {
  const session = getActiveSession();
  messagesContainer.innerHTML = "";
  if (!session) {
    if (welcomePanel) welcomePanel.hidden = false;
    return;
  }

  if (session.messages.length === 0) {
    if (welcomePanel) welcomePanel.hidden = false;
    return;
  }

  if (welcomePanel) welcomePanel.hidden = true;

  session.messages.forEach((message) => {
    const messageText =
      extractTextFromContent(message.content) ||
      createDraftMessageLabel("", message.attachments || []);
    addMsg(messageText, message.role, false, message.attachments || []);
  });
}

function touchSession(session) {
  session.updatedAt = Date.now();
  persistSessions();
  renderChatList();
}

function switchSession(sessionId) {
  if (!sessions.some((session) => session.id === sessionId)) return;
  activeSessionId = sessionId;
  renderChatList();
  renderMessages();
}

function createAndSwitchSession() {
  const session = createSession();
  sessions.push(session);
  activeSessionId = session.id;
  persistSessions();
  renderChatList();
  renderMessages();
}

function deleteSession(sessionId) {
  const next = sessions.filter((session) => session.id !== sessionId);
  sessions = next;

  if (sessions.length === 0) {
    createAndSwitchSession();
    return;
  }

  if (activeSessionId === sessionId) {
    activeSessionId = getNewestSessionId();
  }

  persistSessions();
  renderChatList();
  renderMessages();
}

function getThemeToken(name, fallback) {
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

function extractTextFromContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" ? String(part.text || "") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function renderAttachmentTray() {
  if (!attachmentTray) return;

  attachmentTray.innerHTML = "";

  if (draftAttachments.length === 0) {
    attachmentTray.hidden = true;
    return;
  }

  attachmentTray.hidden = false;

  for (const attachment of draftAttachments) {
    const tile = document.createElement("div");
    tile.className = "attachment-tile";

    const img = document.createElement("img");
    img.src = attachment.previewUrl;
    img.alt = attachment.name;

    const meta = document.createElement("div");
    meta.className = "attachment-meta";

    const title = document.createElement("span");
    title.className = "attachment-name";
    title.textContent = attachment.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      removeDraftAttachment(attachment.id);
    });

    meta.appendChild(title);
    meta.appendChild(remove);
    tile.appendChild(img);
    tile.appendChild(meta);
    attachmentTray.appendChild(tile);
  }
}

function removeDraftAttachment(attachmentId) {
  const next = draftAttachments.filter((item) => item.id !== attachmentId);
  const removed = draftAttachments.find((item) => item.id === attachmentId);
  if (removed?.previewUrl) {
    URL.revokeObjectURL(removed.previewUrl);
  }
  draftAttachments = next;
  renderAttachmentTray();
}

function clearDraftAttachments() {
  draftAttachments.forEach((attachment) => {
    if (attachment?.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  });
  draftAttachments = [];
  renderAttachmentTray();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function addDraftAttachments(files) {
  const acceptedFiles = [...files].filter((file) => file.type.startsWith("image/"));
  if (acceptedFiles.length === 0) return;

  const nextAttachments = [];

  for (const file of acceptedFiles) {
    const previewUrl = URL.createObjectURL(file);
    const dataUrl = await readFileAsDataUrl(file);
    nextAttachments.push({
      id: createId(),
      name: file.name,
      type: file.type,
      previewUrl,
      dataUrl,
    });
  }

  draftAttachments = [...draftAttachments, ...nextAttachments];
  renderAttachmentTray();
}

function getDraftUserContent(text, attachments) {
  const trimmedText = String(text || "").trim();
  const imageParts = attachments.map((attachment) => ({
    type: "image_url",
    image_url: { url: attachment.dataUrl, detail: "auto" },
  }));

  if (trimmedText && imageParts.length === 0) {
    return trimmedText;
  }

  if (!trimmedText && imageParts.length === 1) {
    return imageParts;
  }

  const parts = [];
  if (trimmedText) {
    parts.push({ type: "text", text: trimmedText });
  }
  parts.push(...imageParts);
  return parts;
}

function createDraftMessageLabel(text, attachments) {
  const trimmedText = String(text || "").trim();
  if (trimmedText) return trimmedText;
  if (attachments.length === 1) return "Image attachment";
  return `${attachments.length} image attachments`;
}

function extractFingerprintValue(result) {
  if (!result) return "";
  if (typeof result === "string") return result.trim();
  if (typeof result !== "object") return String(result).trim();

  const candidateKeys = [
    "thumbmark",
    "fingerprint",
    "visitorId",
    "visitor_id",
    "id",
  ];

  for (const key of candidateKeys) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  try {
    return JSON.stringify(result);
  } catch {
    return "";
  }
}

async function loadClientFingerprint() {
  try {
    const cachedValue = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
    if (cachedValue) return cachedValue;

    const thumbmarkModule = await import(THUMBMARK_MODULE_URL);
    const ThumbmarkClass =
      thumbmarkModule.Thumbmark ||
      thumbmarkModule.default?.Thumbmark ||
      thumbmarkModule.default;

    if (typeof ThumbmarkClass !== "function") {
      return "";
    }

    const thumbmark = new ThumbmarkClass();
    const result = await thumbmark.get();
    const fingerprint = extractFingerprintValue(result);

    if (fingerprint) {
      localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
    }

    return fingerprint;
  } catch {
    return localStorage.getItem(FINGERPRINT_STORAGE_KEY) || "";
  }
}

function getClientFingerprint() {
  if (!fingerprintPromise) {
    fingerprintPromise = loadClientFingerprint();
  }
  return fingerprintPromise;
}

function getAssistantTheme() {
  return {
    background: getThemeToken("--background", "#0f1117"),
    surface: getThemeToken("--secondary", "#171a23"),
    text: getThemeToken("--text", "#e9edf7"),
    border: getThemeToken("--border", "#2d3342"),
    accent: getThemeToken("--accent", "#4f79ff"),
  };
}

function ensureCaptureVideo() {
  if (captureVideo) return captureVideo;
  captureVideo = document.createElement("video");
  captureVideo.muted = true;
  captureVideo.autoplay = true;
  captureVideo.playsInline = true;
  return captureVideo;
}

function getTopLevelSameOriginWindow() {
  try {
    if (
      window.top &&
      window.top !== window &&
      window.top.location.origin === window.location.origin
    ) {
      return window.top;
    }
  } catch {
    return window;
  }
  return window;
}

function waitTwoFrames() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function renderAssistantWindow() {
  if (!assistantSession || assistantSession.window.closed) {
    assistantSession = null;
    return;
  }

  const theme = getAssistantTheme();
  const { window: win, elements } = assistantSession;
  const output = assistantState.error || assistantState.output;
  const hasOutput = Boolean(output);

  win.document.documentElement.style.setProperty(
    "--assistant-bg",
    theme.background,
  );
  win.document.documentElement.style.setProperty(
    "--assistant-surface",
    theme.surface,
  );
  win.document.documentElement.style.setProperty(
    "--assistant-text",
    theme.text,
  );
  win.document.documentElement.style.setProperty(
    "--assistant-border",
    theme.border,
  );
  win.document.documentElement.style.setProperty(
    "--assistant-accent",
    theme.accent,
  );

  elements.statusDot.style.background = screenStream ? "#22c55e" : "#ef4444";
  elements.statusText.textContent = screenStream
    ? "Screen sharing active"
    : "Screen sharing inactive";
  elements.shareBtn.textContent = screenStream
    ? "Stop Sharing"
    : "Share Screen";
  elements.askBtn.disabled = assistantState.isAsking;
  elements.askBtn.textContent = assistantState.isAsking ? "Thinking..." : "Ask";
  elements.outputWrap.style.display = hasOutput ? "block" : "none";
  elements.outputWrap.innerHTML = hasOutput ? marked(output) : "";
}

function closeAssistantWindow() {
  if (!assistantSession) return;
  try {
    assistantSession.window.close();
  } catch {}
  assistantSession = null;
}

function ensureAssistantMarkup(doc) {
  const existingRoot = doc.getElementById("sa-root");
  if (existingRoot) {
    return;
  }

  doc.title = "Shadow Screen Assistant";
  doc.body.innerHTML = "";
  doc.body.style.margin = "0";
  doc.body.style.height = "100vh";
  doc.body.style.background = "var(--assistant-bg)";
  doc.body.style.color = "var(--assistant-text)";
  doc.body.style.fontFamily = "Poppins, sans-serif";

  let style = doc.getElementById("sa-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "sa-style";
    style.textContent = `
      * { box-sizing: border-box; }
      body { overflow: hidden; }
      .root {
        height: 100%;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 8px;
        padding: 10px;
        background:
          radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--assistant-accent) 12%, transparent) 0%, transparent 60%),
          linear-gradient(160deg, color-mix(in srgb, var(--assistant-surface) 94%, black 6%), var(--assistant-bg));
      }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 7px 10px;
        border: 1px solid color-mix(in srgb, var(--assistant-border) 88%, white 12%);
        border-radius: 11px;
        background: color-mix(in srgb, var(--assistant-surface) 92%, transparent);
      }
      .brand {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.88;
      }
      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--assistant-border);
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 11px;
      }
      .dot { width: 7px; height: 7px; border-radius: 999px; box-shadow: 0 0 10px currentColor; }
      .status { opacity: 0.88; }
      .prompt {
        width: 100%;
        min-height: 62px;
        max-height: 130px;
        resize: vertical;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--assistant-border) 85%, white 15%);
        background: color-mix(in srgb, var(--assistant-surface) 94%, black 6%);
        color: var(--assistant-text);
        padding: 10px 11px;
        outline: none;
        font-family: Poppins, sans-serif;
        line-height: 1.4;
      }
      .prompt:focus { border-color: var(--assistant-accent); }
      .actions { display: flex; align-items: center; gap: 8px; }
      .btn {
        height: 32px;
        border-radius: 9px;
        border: 1px solid var(--assistant-border);
        background: color-mix(in srgb, var(--assistant-surface) 90%, black 10%);
        color: var(--assistant-text);
        padding: 0 11px;
        cursor: pointer;
        font-family: Poppins, sans-serif;
        font-size: 12px;
      }
      .btn:hover { border-color: var(--assistant-accent); }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .btn.ask {
        background: linear-gradient(145deg, color-mix(in srgb, var(--assistant-accent) 85%, white 15%), var(--assistant-accent));
        border-color: color-mix(in srgb, var(--assistant-accent) 70%, white 30%);
        color: #fff;
        font-weight: 600;
      }
      .spacer { flex: 1; }
      .output {
        display: none;
        overflow: auto;
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--assistant-border) 86%, white 14%);
        background: color-mix(in srgb, var(--assistant-surface) 93%, black 7%);
        padding: 10px;
        font-size: 13px;
        line-height: 1.52;
      }
      .output p { margin: 0 0 8px; }
      .output p:last-child { margin-bottom: 0; }
      .output pre {
        overflow-x: auto;
        border: 1px solid var(--assistant-border);
        border-radius: 8px;
        padding: 8px;
        background: color-mix(in srgb, var(--assistant-surface) 80%, black 20%);
      }
      .output code {
        background: color-mix(in srgb, var(--assistant-surface) 80%, black 20%);
        padding: 1px 4px;
        border-radius: 4px;
      }
    `;
    doc.head.appendChild(style);
  }

  const root = doc.createElement("div");
  root.id = "sa-root";
  root.className = "root";
  root.innerHTML = `
    <div class="topbar">
      <span class="brand">Shadow Assistant</span>
      <span class="status-chip">
        <span class="dot" id="sa-dot"></span>
        <span class="status" id="sa-status"></span>
      </span>
    </div>
    <textarea class="prompt" id="sa-input" placeholder="Ask about your current screen..."></textarea>
    <div class="actions">
      <button class="btn" id="sa-share" type="button">Share Screen</button>
      <button class="btn ask" id="sa-ask" type="button">Ask</button>
      <span class="spacer"></span>
      <button class="btn" id="sa-close" type="button">Close</button>
    </div>
    <div class="output" id="sa-output"></div>
  `;
  doc.body.appendChild(root);
}

async function openAssistantWindow() {
  if (assistantSession && !assistantSession.window.closed) {
    assistantSession.window.focus();
    return;
  }

  const hostWindow = getTopLevelSameOriginWindow();
  let targetWindow = null;

  const pipApi = hostWindow.documentPictureInPicture;
  if (pipApi?.requestWindow) {
    try {
      targetWindow = await pipApi.requestWindow({
        width: 430,
        height: 170,
        disallowReturnToOpener: true,
        preferInitialWindowPlacement: true,
      });
    } catch {
      targetWindow = null;
    }
  }

  if (!targetWindow) {
    addMsg(
      "Picture-in-Picture is unavailable in this browser/context.",
      ASSISTANT,
    );
    return;
  }

  const doc = targetWindow.document;
  ensureAssistantMarkup(doc);

  const elements = {
    statusDot: doc.getElementById("sa-dot"),
    statusText: doc.getElementById("sa-status"),
    input: doc.getElementById("sa-input"),
    shareBtn: doc.getElementById("sa-share"),
    askBtn: doc.getElementById("sa-ask"),
    closeBtn: doc.getElementById("sa-close"),
    outputWrap: doc.getElementById("sa-output"),
  };

  assistantSession = { window: targetWindow, elements };

  elements.shareBtn.addEventListener("click", async () => {
    if (screenStream) {
      stopScreenShare();
    } else {
      await startScreenShare();
    }
    renderAssistantWindow();
  });

  const submitAsk = async () => {
    const prompt = elements.input.value.trim();
    if (!prompt || assistantState.isAsking) return;
    await askFromAssistant(prompt);
  };

  elements.askBtn.addEventListener("click", () => {
    void submitAsk();
  });

  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitAsk();
    }
  });

  elements.closeBtn.addEventListener("click", () => {
    closeAssistantWindow();
    stopScreenShare();
  });

  targetWindow.addEventListener(
    "pagehide",
    () => {
      window.setTimeout(() => {
        if (!targetWindow.closed) {
          return;
        }
        assistantSession = null;
        stopScreenShare();
      }, 0);
    },
    { once: true },
  );

  renderAssistantWindow();
  targetWindow.focus();
}

function updateShareUi() {
  const sharing = Boolean(screenStream);
  screenShareBtn.textContent = sharing ? "Stop Sharing" : "Share Screen";
  screenShareBtn.classList.toggle("active", sharing);
  screenShareStatus.textContent = sharing ? "Sharing active" : "Not sharing";
  renderAssistantWindow();
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
  }
  screenStream = null;
  screenVideoTrack = null;
  if (captureVideo) {
    captureVideo.srcObject = null;
  }
  updateShareUi();
}

async function startScreenShare() {
  if (screenStream) return true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("No video track in screen stream");
    track.addEventListener("ended", stopScreenShare);

    const video = ensureCaptureVideo();
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    screenStream = stream;
    screenVideoTrack = track;
    updateShareUi();
    return true;
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Could not start screen sharing";
    addMsg(`Screen share error: ${msg}`, ASSISTANT);
    stopScreenShare();
    return false;
  }
}

async function captureScreenFrameDataUrl() {
  if (!screenStream) {
    throw new Error("Screen sharing is not active");
  }

  const video = ensureCaptureVideo();
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Timed out waiting for screen frame")),
        1200,
      );
      const onLoaded = () => {
        window.clearTimeout(timeout);
        video.removeEventListener("loadeddata", onLoaded);
        resolve();
      };
      video.addEventListener("loadeddata", onLoaded);
    });
  }

  const sourceWidth = Math.max(1, video.videoWidth);
  const sourceHeight = Math.max(1, video.videoHeight);
  const maxWidth = 1280;
  const scale = sourceWidth > maxWidth ? maxWidth / sourceWidth : 1;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context unavailable");
  }
  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function getContextMessages(sessionId = activeSessionId) {
  const session = getSessionById(sessionId);
  if (!session) return [];
  return session.messages.slice(-CONTEXT_LIMIT).map((item) => ({
    role: item.role,
    content:
      Array.isArray(item.content) || typeof item.content === "string"
        ? item.content
        : getDraftUserContent(item.content, item.attachments || []),
  }));
}

async function buildOutboundMessages(
  useScreenForLatestUser = false,
  sessionId = activeSessionId,
) {
  const contextMessages = getContextMessages(sessionId);
  if (
    !useScreenForLatestUser ||
    !screenStream ||
    contextMessages.length === 0
  ) {
    return contextMessages;
  }

  const lastIndex = contextMessages.length - 1;
  const latest = contextMessages[lastIndex];
  if (!latest || latest.role !== USER) {
    return contextMessages;
  }

  const imageDataUrl = await captureScreenFrameDataUrl();
  return contextMessages.map((entry, index) => {
    if (index !== lastIndex) return entry;

    const content = Array.isArray(entry.content)
      ? [...entry.content]
      : [{ type: "text", text: String(entry.content || "") }];

    content.push({
      type: "image_url",
      image_url: { url: imageDataUrl, detail: "auto" },
    });

    return {
      role: USER,
      content,
    };
  });
}

async function getCsrfToken() {
  try {
    const response = await fetch("/csrf-token", { credentials: "include" });
    const data = await response.json();
    return data.csrfToken;
  } catch {
    return null;
  }
}

async function requestAssistantResponse(messages, model) {
  const fingerprint = await getClientFingerprint();
  const response = await fetch("/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      ...(fingerprint ? { "x-shadow-fingerprint": fingerprint } : {}),
    },
    credentials: "include",
    body: JSON.stringify({ messages, model }),
  });

  const data = await response.json();
  return data.error ? `Error: ${data.error}` : data.message || String(data);
}

async function askFromAssistant(prompt) {
  if (!screenStream) {
    assistantState.error = "Start screen sharing first.";
    assistantState.output = "";
    renderAssistantWindow();
    return;
  }

  assistantState.isAsking = true;
  assistantState.error = "";
  assistantState.output = "Thinking...";
  renderAssistantWindow();

  const hideDuringCapture =
    screenVideoTrack?.getSettings?.().displaySurface === "monitor" &&
    assistantSession &&
    !assistantSession.window.closed;

  try {
    if (hideDuringCapture) {
      assistantSession.window.document.body.style.visibility = "hidden";
      await waitTwoFrames();
    }

    const imageDataUrl = await captureScreenFrameDataUrl();

    if (
      hideDuringCapture &&
      assistantSession &&
      !assistantSession.window.closed
    ) {
      assistantSession.window.document.body.style.visibility = "visible";
      assistantSession.window.focus();
    }

    const messages = [
      {
        role: USER,
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "auto" },
          },
        ],
      },
    ];

    const aiMsg = await requestAssistantResponse(
      messages,
      modelSelector.value,
    );
    assistantState.output = aiMsg;
    assistantState.error = "";
  } catch (error) {
    if (assistantSession && !assistantSession.window.closed) {
      assistantSession.window.document.body.style.visibility = "visible";
    }
    assistantState.error =
      error instanceof Error ? error.message : "Failed to ask about screen";
    assistantState.output = "";
  } finally {
    assistantState.isAsking = false;
    renderAssistantWindow();
  }
}

function addMsg(content, role, isLoading = false, attachments = []) {
  const msgElement = document.createElement("div");
  msgElement.classList.add("message", role);

  if (isLoading) {
    msgElement.classList.add("loading");
    msgElement.innerHTML = `<div class="spinner"></div>${content}`;
  } else {
    msgElement.innerHTML = marked(content);
  }

  if (attachments.length > 0) {
    const attachmentWrap = document.createElement("div");
    attachmentWrap.className = "message-attachments";

    for (const attachment of attachments) {
      const image = document.createElement("img");
      image.src = attachment.dataUrl || attachment.previewUrl;
      image.alt = attachment.name || "Uploaded image";
      attachmentWrap.appendChild(image);
    }

    msgElement.appendChild(attachmentWrap);
  }

  messagesContainer.appendChild(msgElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  setTimeout(() => {
    msgElement.classList.add("show");
  }, 10);

  return msgElement;
}

function addMessageToSession(role, content, sessionId = activeSessionId) {
  const session = getSessionById(sessionId);
  if (!session) return;

  let attachments = [];
  let messageContent = content;

  if (typeof content === "object" && content !== null && !Array.isArray(content)) {
    attachments = Array.isArray(content.attachments) ? content.attachments : [];
    messageContent = content.content;
  }

  session.messages.push({ role, content: messageContent, attachments, createdAt: Date.now() });
  if (
    role === USER &&
    session.messages.filter((msg) => msg.role === USER).length === 1
  ) {
    session.title = compactTitle(
      extractTextFromContent(messageContent) || "Image attachment",
    );
  }

  touchSession(session);
}

async function sendMsg() {
  const message = textarea.value.trim();
  if (!message && draftAttachments.length === 0) return;

  const requestSessionId = activeSessionId;
  if (!requestSessionId) return;

  const outboundAttachments = draftAttachments.map((attachment) => ({
    ...attachment,
  }));
  const displayMessage = createDraftMessageLabel(message, outboundAttachments);
  const content = getDraftUserContent(message, outboundAttachments);

  addMessageToSession(
    USER,
    {
      content,
      attachments: outboundAttachments,
    },
    requestSessionId,
  );
  addMsg(displayMessage, USER, false, outboundAttachments);
  textarea.value = "";
  clearDraftAttachments();

  let outboundMessages;
  try {
    outboundMessages = await buildOutboundMessages(
      Boolean(screenStream),
      requestSessionId,
    );
  } catch (captureError) {
    const msg =
      captureError instanceof Error
        ? captureError.message
        : "Failed to capture screen frame";
    addMsg(`Screen capture failed: ${msg}`, ASSISTANT);
    return;
  }

  const loadingMsg = addMsg("", ASSISTANT, true);

  try {
    const aiMsg = await requestAssistantResponse(
      outboundMessages,
      modelSelector.value,
    );

    if (activeSessionId === requestSessionId && loadingMsg.isConnected) {
      loadingMsg.innerHTML = marked(aiMsg);
      loadingMsg.classList.remove("loading");
      loadingMsg.classList.add("show");
      loadingMsg.addEventListener("click", () => {
        navigator.clipboard.writeText(aiMsg);
      });
    }

    addMessageToSession(ASSISTANT, aiMsg, requestSessionId);
  } catch {
    if (activeSessionId === requestSessionId && loadingMsg.isConnected) {
      loadingMsg.innerHTML = "Failed to reach Shadow Assistant. Try again.";
      loadingMsg.classList.remove("loading");
      loadingMsg.classList.add("show");
    }
  }
}

async function init() {
  csrfToken = await getCsrfToken();
  void getClientFingerprint();

  sessions = loadSessions();
  if (sessions.length === 0) {
    sessions = [createSession()];
  }
  activeSessionId = getNewestSessionId();

  renderChatList();
  renderMessages();
  renderAttachmentTray();
  updateShareUi();

  sendBtn.addEventListener("click", async () => {
    await sendMsg();
  });

  uploadImageBtn.addEventListener("click", () => {
    imagePicker.click();
  });

  imagePicker.addEventListener("change", async () => {
    if (imagePicker.files) {
      await addDraftAttachments(imagePicker.files);
      imagePicker.value = "";
    }
  });

  chatSearchInput.addEventListener("input", () => {
    renderChatList();
  });

  quickPromptCards.forEach((card) => {
    card.addEventListener("click", () => {
      textarea.value = card.dataset.prompt || "";
      textarea.focus();
    });
  });

  screenShareBtn.addEventListener("click", async () => {
    if (screenStream) {
      stopScreenShare();
      return;
    }
    const started = await startScreenShare();
    if (started) {
      await openAssistantWindow();
    }
  });

  newChatBtn.addEventListener("click", () => {
    createAndSwitchSession();
  });

  textarea.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !(event.shiftKey || event.ctrlKey || event.altKey)
    ) {
      event.preventDefault();
      void sendMsg();
    }
  });

  window.addEventListener("beforeunload", () => {
    closeAssistantWindow();
    stopScreenShare();
  });
}

void init();
