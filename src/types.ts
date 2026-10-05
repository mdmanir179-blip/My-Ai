export type WorkspaceTab = "command" | "emails" | "whatsapp" | "search" | "tasks";

export type VoiceOption = "Kore" | "Puck" | "Zephyr" | "Charon" | "Fenrir";

export interface EmailItem {
  id: string;
  to: string;
  subject: string;
  body: string;
  priority: "Normal" | "High";
  status: "Drafted by AI" | "Dispatched" | "Incoming Needs Reply";
  timestamp: string;
}

export interface WhatsAppItem {
  id: string;
  contactName: string;
  phoneNumber: string;
  incomingMessage: string;
  aiReply: string;
  status: "Auto-Replied" | "Ready to Send" | "Pending AI Answer";
  timestamp: string;
  isLiveDeviceMessage?: boolean;
}

export interface WhatsAppConnectionStatus {
  state: "disconnected" | "connecting" | "qr_ready" | "connected" | "error";
  qrDataUrl: string | null;
  pairingCode: string | null;
  connectedUser: {
    id: string;
    name: string;
    phone: string;
  } | null;
  autoReplyEnabled: boolean;
  replyToSelfMessages: boolean;
  lastError: string | null;
  liveMessages: WhatsAppItem[];
}

export interface SearchSource {
  title: string;
  uri: string;
}

export interface SearchRecord {
  id: string;
  query: string;
  summary: string;
  sources: SearchSource[];
  timestamp: string;
}

export interface SystematicTask {
  id: string;
  title: string;
  category: string;
  dueTime: string;
  notes: string;
  completed: boolean;
  timestamp: string;
}

export interface ExecutedAction {
  id: string;
  toolName: "draft_email" | "reply_whatsapp" | "create_systematic_task" | string;
  args: Record<string, any>;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  isVoice?: boolean;
  executedActions?: ExecutedAction[];
  searchSources?: SearchSource[];
  audioBase64?: string;
}
