import {
  EmailItem,
  WhatsAppItem,
  SystematicTask,
  SearchRecord,
  ConversationMessage,
} from "./types";

export const INITIAL_EMAILS: EmailItem[] = [
  {
    id: "em-101",
    to: "rahim.ahmed@dhakatech.com",
    subject: "Q4 Project Milestone & Budget Approval Update",
    body: "Hello Rahim,\n\nOur Q4 project milestone report and budget breakdown have been finalized. We will review the complete execution timeline during tomorrow's 12:00 PM meeting.\n\nBest regards,\nExecutive Office",
    priority: "High",
    status: "Dispatched",
    timestamp: "10:15 AM",
  },
  {
    id: "em-102",
    to: "billing@cloudservices.io",
    subject: "Invoice #INV-2026-098 Verification Request",
    body: "Hello Finance Team,\n\nPlease find the verification request for our October cloud infrastructure invoice #INV-2026-098. Kindly confirm receipt and share the updated statement.\n\nBest regards,\nOperations Desk",
    priority: "Normal",
    status: "Dispatched",
    timestamp: "09:30 AM",
  },
  {
    id: "em-103",
    to: "nusrat.jahan@creativeagency.bd",
    subject: "Brand Campaign Design Assets Review",
    body: "Hi Nusrat,\n\nCould you share the final vector files for the upcoming campaign before Thursday? Let me know if the team needs any additional copy adjustments.",
    priority: "High",
    status: "Drafted by AI",
    timestamp: "Yesterday",
  },
];

export const INITIAL_WHATSAPP: WhatsAppItem[] = [
  {
    id: "wa-201",
    contactName: "Tanvir Hasan (Client)",
    phoneNumber: "+8801711002244",
    incomingMessage: "ভাইয়া, আজকে বিকেলে কি আমাদের প্রজেক্ট ডেমো মিটিংটা কনফার্ম?",
    aiReply: "হ্যাঁ তানভীর ভাই, আজ বিকেল ৪:৩০ মিনিটে আমাদের ডেমো মিটিং কনফার্ম করা হয়েছে। আমি মিটিং লিংক কিছুক্ষণের মধ্যেই পাঠিয়ে দিচ্ছি।",
    status: "Auto-Replied",
    timestamp: "10:42 AM",
  },
  {
    id: "wa-202",
    contactName: "Vikram Sharma (Partner)",
    phoneNumber: "+919820112233",
    incomingMessage: "नमस्ते, क्या आज शाम तक प्रोजेक्ट प्रपोजल मिल सकता है?",
    aiReply: "नमस्ते विक्रम जी, हाँ बिल्कुल! आज शाम 6 बजे से पहले मैं आपको पूरा प्रोजेक्ट प्रपोजल भेज दूंगा।",
    status: "Auto-Replied",
    timestamp: "10:10 AM",
  },
  {
    id: "wa-203",
    contactName: "Farhana Islam (Team Lead)",
    phoneNumber: "+8801819334455",
    incomingMessage: "Can you approve the vendor quotation for the server upgrade?",
    aiReply: "I have reviewed the quotation summary. Everything looks good—please proceed with the vendor onboarding today.",
    status: "Auto-Replied",
    timestamp: "09:50 AM",
  },
];

export const INITIAL_TASKS: SystematicTask[] = [
  {
    id: "tsk-301",
    title: "Send Q4 Project Milestone Email to Rahim",
    category: "Email Follow-up",
    dueTime: "Today 12:00 PM",
    notes: "Attach finalized Q4 budget breakdown and confirm Zoom schedule.",
    completed: false,
    timestamp: "10:15 AM",
  },
  {
    id: "tsk-302",
    title: "Share Project Proposal with Vikram Sharma on WhatsApp",
    category: "WhatsApp",
    dueTime: "Today 06:00 PM",
    notes: "Send PDF proposal directly via WhatsApp integration.",
    completed: false,
    timestamp: "10:10 AM",
  },
  {
    id: "tsk-303",
    title: "Research latest global AI & cloud infrastructure market trends",
    category: "Research",
    dueTime: "Tomorrow 11:00 AM",
    notes: "Compile key circular highlights and executive summary.",
    completed: true,
    timestamp: "Yesterday",
  },
];

export const INITIAL_SEARCHES: SearchRecord[] = [
  {
    id: "srch-401",
    query: "Latest global technology & AI market news today",
    summary:
      "Real-time web search grounding is active. Ask any question by voice or text in English, Bengali, or Hindi to retrieve verified live sources and spoken answers automatically.",
    sources: [
      { title: "Google Search Live Grounding", uri: "https://www.google.com" },
    ],
    timestamp: "09:15 AM",
  },
];

export const INITIAL_MESSAGES: ConversationMessage[] = [
  {
    id: "msg-init-1",
    role: "assistant",
    text: "Hello! I am MS Agent, your autonomous Personal AI Assistant. Full Auto-Pilot is active: I automatically compose and dispatch emails, directly answer WhatsApp messages, run live Google searches, and organize your daily tasks. You can speak to me in English, Bengali (বাংলা), or Hindi (हिन्दी)—and I will always answer you by voice in the exact same language!",
    timestamp: "Just now",
  },
];

export const QUICK_VOICE_PROMPTS = [
  {
    label: "EN: Send WhatsApp to Farhana",
    prompt: "Send a WhatsApp message to Farhana Islam saying the server upgrade budget is approved and she can start immediately.",
  },
  {
    label: "BN: রহিম ভাইকে মিটিংয়ের ইমেইল করো",
    prompt: "রহিম ভাইকে আগামীকাল সকাল ১১টায় প্রজেক্ট রিভিউ মিটিংয়ের জন্য একটি ফরমাল ইমেইল লিখে পাঠিয়ে দাও।",
  },
  {
    label: "HI: विक्रम को व्हाट्सएप मैसेज भेजो",
    prompt: "विक्रम शर्मा को व्हाट्सएप पर मैसेज भेज दो कि कल सुबह 10 बजे हमारी मीटिंग पक्की है।",
  },
  {
    label: "EN: Search Today's Tech News",
    prompt: "Search Google for today's top artificial intelligence and technology news and summarize it for me.",
  },
];
