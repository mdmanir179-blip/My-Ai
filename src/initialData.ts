import {
  EmailItem,
  WhatsAppItem,
  SystematicTask,
  SearchRecord,
  ConversationMessage,
} from "./types";

export const INITIAL_EMAILS: EmailItem[] = [];

export const INITIAL_WHATSAPP: WhatsAppItem[] = [];

export const INITIAL_TASKS: SystematicTask[] = [];

export const INITIAL_SEARCHES: SearchRecord[] = [];

export const INITIAL_MESSAGES: ConversationMessage[] = [];

export const QUICK_VOICE_PROMPTS: Array<{
  label: string;
  lang: string;
  prompt: string;
}> = [];
