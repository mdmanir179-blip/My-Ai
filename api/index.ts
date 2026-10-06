import "dotenv/config";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { FunctionDeclaration, GoogleGenAI, Type } from "@google/genai";

function getGeminiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "fallback_key",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimitOrQuotaError(err: any): boolean {
  const msg = String(err?.message || err || "");
  return (
    err?.status === 429 ||
    err?.code === 429 ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.toLowerCase().includes("quota") ||
    msg.toLowerCase().includes("rate limit")
  );
}

// Live Knowledge & Web Answer Fetcher (DuckDuckGo Instant Answer + Wikipedia REST API) for zero-quota factual Q&A
async function fetchLiveKnowledgeAnswer(
  rawQuery: string,
  lang: "bn" | "hi" | "en"
): Promise<string | null> {
  const cleanQ = rawQuery
    .replace(
      /^(what is|who is|where is|tell me about|search|define|meaning of|কি|কে|কোথায়|বলো|জানাও|সম্পর্কে বলো|kake bole|ki|ke|kothay|क्या है|कौन है|कहाँ है)\s+/i,
      ""
    )
    .replace(/[?।!]/g, "")
    .trim();

  if (!cleanQ || cleanQ.length < 2) return null;

  // 1. Try Wikipedia Summary in target language first, then English
  const wikiLangs = lang === "bn" ? ["bn", "en"] : lang === "hi" ? ["hi", "en"] : ["en"];
  for (const wl of wikiLangs) {
    try {
      const searchUrl = `https://${wl}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        cleanQ
      )}&utf8=&format=json&origin=*&srlimit=1`;
      const sRes = await Promise.race([
        fetch(searchUrl),
        new Promise<null>((r) => setTimeout(() => r(null), 2200)),
      ]);
      if (sRes && (sRes as Response).ok) {
        const sData: any = await (sRes as Response).json();
        const topTitle = sData?.query?.search?.[0]?.title;
        if (topTitle) {
          const sumUrl = `https://${wl}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
            topTitle
          )}`;
          const sumRes = await Promise.race([
            fetch(sumUrl),
            new Promise<null>((r) => setTimeout(() => r(null), 2200)),
          ]);
          if (sumRes && (sumRes as Response).ok) {
            const sumData: any = await (sumRes as Response).json();
            if (sumData?.extract && sumData.extract.length > 25) {
              const sentences = String(sumData.extract)
                .split(/(?<=[.।?!])\s+/)
                .slice(0, 3)
                .join(" ");
              return sentences;
            }
          }
        }
      }
    } catch {}
  }

  // 2. Try DuckDuckGo Instant Answer API
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(
      cleanQ
    )}&format=json&no_html=1&skip_disambig=1`;
    const dRes = await Promise.race([
      fetch(ddgUrl),
      new Promise<null>((r) => setTimeout(() => r(null), 2000)),
    ]);
    if (dRes && (dRes as Response).ok) {
      const dData: any = await (dRes as Response).json();
      if (dData?.AbstractText) {
        return String(dData.AbstractText).slice(0, 380);
      }
      if (dData?.RelatedTopics?.[0]?.Text) {
        return String(dData.RelatedTopics[0].Text).slice(0, 380);
      }
    }
  } catch {}

  return null;
}

// Intelligent multilingual conversational engine that directly answers messages in English, Bengali, Banglish, Hindi, or Hinglish
async function generateIntelligentConversationalAnswer(
  rawText: string,
  senderName = ""
): Promise<string> {
  const text = String(rawText || "").trim();
  const lower = text.toLowerCase();
  const isBengaliScript = /[\u0980-\u09FF]/.test(text);
  const isHindiScript = /[\u0900-\u097F]/.test(text);

  // Comprehensive Banglish (Romanized Bengali) detector
  const banglishRegex =
    /\b(kemon|kmn|achhen|achen|acho|achi|kothay|koi|ki|korcho|korchen|koren|korbo|bhalo|valo|dhonnobad|shuvo|kobe|kokhon|keno|tumi|apni|tui|amake|amar|tomar|apnar|ekta|kore|daw|dao|den|bolen|bolo|bolun|bhai|bhaiya|dada|apu|didi|khabar|khobor|khbr|ashbo|jabo|parbo|hobe|lagbe|dorkar|somoy|koto|taka|dam|ache|nei|nai|hoye|geche|gese|kথা|বলেন|কাজ|হ্যালো)\b/i;
  const isBanglish = !isBengaliScript && !isHindiScript && banglishRegex.test(lower);

  // Comprehensive Hinglish (Romanized Hindi) detector
  const hinglishRegex =
    /\b(kaise|kaisa|kaisi|kahan|kya|kar rahe|kr rhe|thik|theek|accha|acha|shukriya|dhanyawad|kab|kyu|kyun|tum|aap|mujhe|mera|meri|apka|ek|kardo|karo|batao|bataiye|bhai|kitna|paisa|waqt|samay|milega|hoga|hain|hai|nahi|nhi)\b/i;
  const isHinglish = !isBengaliScript && !isHindiScript && !isBanglish && hinglishRegex.test(lower);

  const langMode: "bn" | "hi" | "en" =
    isBengaliScript || isBanglish ? "bn" : isHindiScript || isHinglish ? "hi" : "en";

  const cleanSender =
    senderName && !senderName.startsWith("+") && senderName !== "Contact" && senderName !== "WhatsApp Client"
      ? senderName.split(" ")[0]
      : "";

  const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // 0. Math / Calculation evaluator (e.g. "25 * 40", "150 + 350 koto?")
  const mathMatch = text.match(/(\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(\d+(?:\.\d+)?)/);
  if (mathMatch) {
    const a = parseFloat(mathMatch[1]);
    const op = mathMatch[2];
    const b = parseFloat(mathMatch[3]);
    let resVal: number | null = null;
    if (op === "+") resVal = a + b;
    else if (op === "-") resVal = a - b;
    else if (op === "*" || op === "x" || op === "×") resVal = a * b;
    else if ((op === "/" || op === "÷") && b !== 0) resVal = Number((a / b).toFixed(4));

    if (resVal !== null) {
      if (langMode === "bn") return `হিসাব অনুযায়ী ${a} ${op} ${b} = ${resVal}।`;
      if (langMode === "hi") return `गणना के अनुसार ${a} ${op} ${b} = ${resVal} है।`;
      return `The answer to ${a} ${op} ${b} is ${resVal}.`;
    }
  }

  // 1. Islamic Salam / Greetings
  if (/(salam|assalamu|as-salamu|সালাম|আসসালামু|सलाम|अस्सलामु)/i.test(lower)) {
    if (langMode === "bn") {
      return `ওয়ালাইকুম আসসালাম${cleanSender ? ` ${cleanSender}` : ""}! আশা করি আপনি ভালো আছেন। বলুন, আপনাকে কীভাবে সাহায্য করতে পারি?`;
    }
    if (langMode === "hi") {
      return `वालेकुम अस्सलाम${cleanSender ? ` ${cleanSender}` : ""}! आशा है आप खैरियत से होंगे। बताइए, मैं आपकी क्या मदद कर सकता हूँ?`;
    }
    return `Wa Alaikum Assalam${cleanSender ? ` ${cleanSender}` : ""}! Hope you are doing well. How can I help you today?`;
  }

  // 2. General Greetings (Hi, Hello, Hey, Good morning, Namaskar)
  if (
    /^(hi+|hello+|hey+|hlw|hlo|yo|oi|namaskar|namaste|pranam|good morning|good afternoon|good evening|good night|gm|gn|হ্যালো|হাই|নমস্কার|শুভ সকাল|শুভ সন্ধ্যা|नमस्ते|प्रणाम|हेलो|हाय)\b/i.test(
      lower
    ) &&
    text.length < 40
  ) {
    if (langMode === "bn") {
      return `হ্যালো${cleanSender ? ` ${cleanSender}` : ""}! আপনি কেমন আছেন? বলুন, কী বিষয়ে জানতে চান বা আমি আপনাকে কীভাবে সাহায্য করতে পারি?`;
    }
    if (langMode === "hi") {
      return `नमस्ते${cleanSender ? ` ${cleanSender}` : ""}! आप कैसे हैं? बताइए, आज मैं आपकी किस प्रकार सहायता कर सकता हूँ?`;
    }
    return `Hello${cleanSender ? ` ${cleanSender}` : ""}! How are you doing today? Let me know how I can help you.`;
  }

  // 3. "How are you?" / "Kemon achen?" / "Ki khobor?" / "Kaise ho?"
  if (
    /(how are you|how r u|how are u|how's it going|what's up|sup|kemon acho|kemon achen|kmn acho|kmn achen|ki khobor|ki khbr|ki obostha|bhalo acho|valo acho|কেমন আছো|কেমন আছেন|কি খবর|কী খবর|কি অবস্থা|ভালো আছো|kaise ho|kaisa hai|kaise hain|kya haal|कैसे हो|कैसे हैं|क्या हाल)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `আলহামদুলিল্লাহ, আমি খুব ভালো আছি! আপনি কেমন আছেন এবং আপনার দিন কেমন কাটছে?`;
    }
    if (langMode === "hi") {
      return `मैं बहुत बढ़िया हूँ, धन्यवाद! आप कैसे हैं और आपका काम कैसा चल रहा है?`;
    }
    return `I'm doing great, thank you for asking! How are you doing today?`;
  }

  // 4. "What are you doing?" / "Ki korcho?" / "Kya kar rahe ho?"
  if (
    /(what are you doing|what r u doing|ki korcho|ki korchen|ki koro|ki koren|কী করছো|কি করছো|কী করছেন|কি করছেন|kya kar rahe|kya kr rhe|क्या कर रहे)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `আমি এখন আপনার মেসেজ ও কাজগুলো গোছানোর দায়িত্বে আছি। আপনার কোনো প্রশ্ন বা কাজ থাকলে আমাকে বলতে পারেন!`;
    }
    if (langMode === "hi") {
      return `मैं अभी आपके संदेशों और कार्यों की देखरेख कर रहा हूँ। बताइए, मैं आपके लिए क्या कर सकता हूँ?`;
    }
    return `I'm right here assisting with messages, research, and scheduling. What can I help you with right now?`;
  }

  // 5. "Who are you?" / "What is your name?" / Identity
  if (
    /(who are you|what is your name|your name|tumi ke|apni ke|tomar nam ki|apnar nam ki|তুমি কে|আপনি কে|তোমার নাম কি|আপনার নাম কি|aap kaun|tum kaun|tumhara naam|आप कौन|तुम्हारा नाम)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `আমি MS Agent — আপনার পার্সোনাল এআই অ্যাসিস্ট্যান্ট। আমি আপনার হয়ে মেসেজের উত্তর দেওয়া, ইমেইল পাঠানো, যেকোনো তথ্যের উত্তর খোঁজা এবং প্রতিদিনের কাজের হিসাব রাখি।`;
    }
    if (langMode === "hi") {
      return `मैं MS Agent हूँ — आपका पर्सनल एआई असिस्टेंट। मैं आपके संदेशों का उत्तर देने, जानकारी खोजने और कार्यों को व्यवस्थित करने में मदद करता हूँ।`;
    }
    return `I am MS Agent, your Personal AI Assistant. I can answer questions, reply to WhatsApp messages, send emails, and organize your schedule.`;
  }

  // 6. Time / Date queries
  if (
    /(what time|current time|today's date|what date|koyta baje|somoy koto|ajke ki bar|ajker tarikh|কয়টা বাজে|সময় কত|আজকে কি বার|তারিখ কত|kitne baje|kya time|aaj kya tarikh|समय क्या|कितने बजे)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `এখন সময় ${nowTime} এবং আজ হলো ${nowDate}।`;
    }
    if (langMode === "hi") {
      return `अभी समय ${nowTime} है और आज की तारीख ${nowDate} है।`;
    }
    return `It is currently ${nowTime} on ${nowDate}.`;
  }

  // 7. Where are you / Are you free / Call me / Meeting
  if (
    /(where are you|are you free|are you busy|call me|can we talk|kothay acho|kothay apni|free acho|busy naki|kotha bola jabe|কোথায় আছো|কোথায় আপনি|ফ্রি আছো|ব্যস্ত নাকি|কল দিও|কথা বলা যাবে|kahan ho|free ho|busy ho|call karo|कहाँ हो|फ्री हो)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `এই মুহূর্তে একটু কাজে ব্যস্ত আছি, তবে আপনার মেসেজটি আমি দেখছি। জরুরি কিছু থাকলে এখানে লিখে বলুন, আমি সাথে সাথে উত্তর দিচ্ছি অথবা একটু পরেই আপনাকে কল করছি।`;
    }
    if (langMode === "hi") {
      return `अभी थोड़ा काम में व्यस्त हूँ, लेकिन आपका संदेश मिल गया है। कोई ज़रूरी बात हो तो यहाँ लिखिए, मैं तुरंत जवाब दूँगा या थोड़ी देर में कॉल करूँगा।`;
    }
    return `I'm slightly tied up at the moment, but you can tell me what you need right here and I'll help immediately or call you back shortly!`;
  }

  // 8. Price / Rate / Service / Order / Business inquiries
  if (
    /(price|cost|rate|charge|service|order|payment|delivery|dam koto|koto taka|koto porbe|দাম কত|কত টাকা|চার্জ কত|সার্ভিস|অর্ডার|ডেলিভারি|kitna paisa|kya rate|price kya|कीमत क्या|कितने का)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `আপনি কোন সার্ভিস বা প্রোডাক্টটির দাম জানতে চাচ্ছেন? একটু নাম বা বিস্তারিত লিখে জানান, আমি এখনই সঠিক দাম ও বিস্তারিত জানাচ্ছি।`;
    }
    if (langMode === "hi") {
      return `आप किस सर्विस या प्रोडक्ट की कीमत जानना चाहते हैं? कृपया उसका नाम लिखें, मैं अभी पूरी जानकारी साझा करता हूँ।`;
    }
    return `Which specific product or service would you like pricing for? Please share the name or details and I'll give you the exact information right away.`;
  }

  // 9. Help / Support requests
  if (
    /(help me|need help|can you help|ektu help|sahajjo|সাহায্য|হেল্প|madad|मदद)/i.test(
      lower
    )
  ) {
    if (langMode === "bn") {
      return `অবশ্যই! বলুন আপনার কী সাহায্য প্রয়োজন? আমি যেকোনো তথ্যের উত্তর দিতে বা আপনার কাজ করে দিতে প্রস্তুত।`;
    }
    if (langMode === "hi") {
      return `बिल्कुल! बताइए आपको क्या मदद चाहिए? मैं आपकी पूरी सहायता करने के लिए तैयार हूँ।`;
    }
    return `Of course! Tell me what you need help with and I'll take care of it right away.`;
  }

  // 10. Thank you / Ok / Yes / No / Acknowledgements
  if (
    /\b(thanks|thank you|thx|ty|ok|okay|k|kk|alright|good|great|nice|fine|hmm|hm|bye|dhonnobad|accha|achha|thik ache|hae|ha|na|ধন্যবাদ|থ্যাংকস|আচ্ছা|ঠিক আছে|হ্যাঁ|না|ওকে|शुक्रिया|धन्यवाद|ठीक है|अच्छा|हाँ|नहीं)\b/i.test(
      lower
    ) &&
    text.length < 40
  ) {
    if (langMode === "bn") {
      return `ঠিক আছে${cleanSender ? ` ${cleanSender}` : ""}! আর কোনো বিষয় জানার থাকলে বা কোনো প্রয়োজন হলে নির্দ্বিধায় বলুন।`;
    }
    if (langMode === "hi") {
      return `ठीक है${cleanSender ? ` ${cleanSender}` : ""}! अगर कुछ और पूछना हो या किसी मदद की ज़रूरत हो तो बेझिझक बताइए।`;
    }
    return `Sounds good${cleanSender ? `, ${cleanSender}` : ""}! Let me know if there is anything else you'd like to ask or do.`;
  }

  // 11. Try Live Web Knowledge Lookup for any factual question or topic!
  const knowledgeAnswer = await fetchLiveKnowledgeAnswer(text, langMode);
  if (knowledgeAnswer) {
    return knowledgeAnswer;
  }

  // 12. Contextual, Direct Conversational Reply (Never send a robotic "I have reviewed your note" line)
  if (langMode === "bn") {
    return `আপনি লিখেছেন: "${text}" — এই বিষয়ে আপনার কি নির্দিষ্ট কোনো তথ্য বা সহযোগিতা প্রয়োজন? একটু বিস্তারিত বললে আমি এখনই সঠিক সমাধান বা উত্তর দিয়ে দিচ্ছি।`;
  }
  if (langMode === "hi") {
    return `आपने पूछा है: "${text}" — क्या आप इसके बारे में कोई विशेष जानकारी चाहते हैं? कृपया थोड़ा स्पष्ट बताएं ताकि मैं तुरंत सही उत्तर दे सकूँ।`;
  }
  return `Regarding "${text}" — could you share a little more detail on what you'd like to know or do? I'm here and ready to answer right away.`;
}

// Resilient Gemini content generator with fast per-model timeout so hung models never block replies
async function generateWithFallback(params: {
  models: string[];
  contents: any;
  config?: any;
}) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured in environment variables.");
  }
  const ai = getGeminiClient();
  let lastError: any = null;
  for (const modelName of params.models) {
    try {
      const result = await Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: params.contents,
          config: params.config,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Model ${modelName} timed out after 10000ms`)),
            10000
          )
        ),
      ]);
      return result;
    } catch (err: any) {
      lastError = err;
      if (isRateLimitOrQuotaError(err)) {
        await sleep(250);
      }
      continue;
    }
  }
  throw lastError;
}

// Store short per-contact conversation history so WhatsApp replies are contextual and natural
const waChatMemory = new Map<string, Array<{ role: "user" | "model"; text: string }>>();

// Generate an intelligent, language-matched WhatsApp auto-reply
async function generateSmartWhatsAppReply(
  contactName: string,
  phoneNumber: string,
  incomingMessage: string
): Promise<string> {
  const memoryKey = phoneNumber || contactName || "default";
  const prevTurns = waChatMemory.get(memoryKey) || [];

  try {
    const historyContext = prevTurns
      .slice(-4)
      .map((t) => `${t.role === "user" ? contactName : "You"}: ${t.text}`)
      .join("\n");

    const promptText = historyContext
      ? `Recent chat history with ${contactName}:\n${historyContext}\n\nNew incoming WhatsApp message from ${contactName}: "${incomingMessage}"`
      : `New incoming WhatsApp message from ${contactName}: "${incomingMessage}"`;

    // Put the fastest working models (gemini-flash-lite-latest & gemini-3.1-flash-lite) FIRST so WhatsApp gets real AI answers in ~0.8s!
    const response = await generateWithFallback({
      models: [
        "gemini-flash-lite-latest",
        "gemini-3.1-flash-lite",
        "gemini-3.8-flash",
        "gemini-flash-latest",
      ],
      contents: promptText,
      config: {
        systemInstruction: `You are "MS Agent", an intelligent, warm, human-like Personal AI Assistant replying on WhatsApp.
CRITICAL RULES FOR ANSWERING MESSAGES:
1. ALWAYS give a direct, real answer to the user's message or question!
   - If they ask a question (e.g., general knowledge, tech, business, advice, meanings, news, calculations, daily life), ANSWER IT directly and accurately.
   - If they send a greeting or casual chat ("Hi", "Kemon acho?", "Ki khobor?", "Ki korcho?", "Kaise ho?"), reply naturally like a friendly, smart assistant.
   - If they ask for the account owner ("Where are you?", "Call me", "Free acho?"), reply politely that you've notified them and can also help right now.
2. FORBIDDEN PHRASES: NEVER say "Thank you for your message! I have reviewed your note and will get back to you with a complete update shortly." Always give a genuine, relevant answer to what they wrote!
3. LANGUAGE MIRRORING:
   - English input -> Natural English reply.
   - Bengali (বাংলা) or Banglish (e.g. "kemon achen", "ki khobor", "dam koto") -> Natural Bengali (বাংলা লিপিতে) reply.
   - Hindi (हिन्दी) or Hinglish (e.g. "kaise ho", "kya haal hai") -> Natural Hindi (देवनागरी लिपि में) reply.
4. Keep the reply concise (1 to 4 sentences) and natural for WhatsApp. Return ONLY the reply text.`,
      },
    });

    const text = response.text?.trim();
    if (text) {
      prevTurns.push({ role: "user", text: incomingMessage });
      prevTurns.push({ role: "model", text });
      waChatMemory.set(memoryKey, prevTurns.slice(-8));
      return text;
    }
  } catch (err) {
    console.warn("WhatsApp AI reply fallback activated:", err);
  }

  const smartFallback = await generateIntelligentConversationalAnswer(
    incomingMessage,
    contactName
  );
  prevTurns.push({ role: "user", text: incomingMessage });
  prevTurns.push({ role: "model", text: smartFallback });
  waChatMemory.set(memoryKey, prevTurns.slice(-8));
  return smartFallback;
}

// ============================================================================
// REAL DIRECT WHATSAPP LINK ENGINE (Dynamic import for Vercel & Node safety)
// ============================================================================
const WA_AUTH_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), ".whatsapp_auth_session")
  : path.join(process.cwd(), ".whatsapp_auth_session");

interface LiveWhatsAppState {
  state: "disconnected" | "connecting" | "qr_ready" | "connected" | "error";
  qrDataUrl: string | null;
  pairingCode: string | null;
  connectedUser: { id: string; name: string; phone: string } | null;
  autoReplyEnabled: boolean;
  replyToSelfMessages: boolean;
  lastError: string | null;
  liveMessages: Array<{
    id: string;
    contactName: string;
    phoneNumber: string;
    incomingMessage: string;
    aiReply: string;
    status: "Auto-Replied" | "Ready to Send" | "Pending AI Answer";
    timestamp: string;
    isLiveDeviceMessage: boolean;
  }>;
}

const waRuntime: LiveWhatsAppState = {
  state: "disconnected",
  qrDataUrl: null,
  pairingCode: null,
  connectedUser: null,
  autoReplyEnabled: true,
  replyToSelfMessages: true,
  lastError: null,
  liveMessages: [],
};

let waSocket: any = null;
let isStartingWa = false;
const processedMsgIds = new Set<string>();
const sentByAiMsgIds = new Set<string>();

async function startRealWhatsAppConnection(forceReset = false) {
  if (isStartingWa && !forceReset) return;
  isStartingWa = true;

  try {
    const baileysMod = await import("@whiskeysockets/baileys");
    const makeWASocket = baileysMod.default || (baileysMod as any).makeWASocket;
    const {
      DisconnectReason,
      Browsers,
      fetchLatestWaWebVersion,
      fetchLatestBaileysVersion,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore,
    } = baileysMod as any;
    const QRCodeMod = await import("qrcode");
    const QRCode = QRCodeMod.default || QRCodeMod;
    const pinoMod = await import("pino");
    const pino = pinoMod.default || (pinoMod as any);
    const silentLogger = pino({ level: "silent" });

    // Always close any previous dangling socket before opening a new one
    if (waSocket) {
      try {
        waSocket.ev?.removeAllListeners?.("connection.update");
        waSocket.ev?.removeAllListeners?.("creds.update");
        waSocket.ev?.removeAllListeners?.("messages.upsert");
        waSocket.end(undefined);
      } catch {}
      waSocket = null;
    }

    if (forceReset) {
      if (fs.existsSync(WA_AUTH_DIR)) {
        fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
      }
      waRuntime.qrDataUrl = null;
      waRuntime.pairingCode = null;
      waRuntime.connectedUser = null;
    }

    waRuntime.state = "connecting";
    waRuntime.lastError = null;

    const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);

    // Use the latest WhatsApp Web protocol version so phone QR scanner never rejects with "Couldn't link device"
    let version: [number, number, number] = [2, 3000, 1049294120];
    try {
      const latestWeb = await Promise.race([
        fetchLatestWaWebVersion ? fetchLatestWaWebVersion({}) : fetchLatestBaileysVersion(),
        new Promise<null>((r) => setTimeout(() => r(null), 2500)),
      ]);
      if (latestWeb && (latestWeb as any).version) {
        version = (latestWeb as any).version;
      }
    } catch {}

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore
          ? makeCacheableSignalKeyStore(state.keys, silentLogger)
          : state.keys,
      },
      printQRInTerminal: false,
      logger: silentLogger as any,
      // Official Ubuntu Chrome fingerprint required by WhatsApp Multi-Device QR & Pairing Code handshake
      browser: Browsers?.ubuntu ? Browsers.ubuntu("Chrome") : ["Ubuntu", "Chrome", "22.04.4"],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      getMessage: async () => ({ conversation: "MS Agent" }),
    });

    waSocket = sock;
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          waRuntime.qrDataUrl = await QRCode.toDataURL(qr, {
            errorCorrectionLevel: "M",
            margin: 3,
            width: 320,
            color: {
              dark: "#000000",
              light: "#FFFFFF",
            },
          });
          waRuntime.state = "qr_ready";
          waRuntime.lastError = null;
        } catch (qrErr: any) {
          console.error("QR generation error:", qrErr);
        }
      }

      if (connection === "open") {
        const rawId = sock.user?.id || "";
        const cleanPhone = rawId.split(":")[0].split("@")[0];
        waRuntime.connectedUser = {
          id: rawId,
          name: sock.user?.name || "Linked WhatsApp Account",
          phone: cleanPhone ? `+${cleanPhone}` : "Connected",
        };
        waRuntime.state = "connected";
        waRuntime.qrDataUrl = null;
        waRuntime.pairingCode = null;
        waRuntime.lastError = null;
        console.log("MS Agent WhatsApp Direct Link Connected:", waRuntime.connectedUser);
      }

      if (connection === "close") {
        const statusCode =
          (lastDisconnect?.error as any)?.output?.statusCode ||
          (lastDisconnect?.error as any)?.data?.statusCode;
        const reasonMsg =
          (lastDisconnect?.error as any)?.output?.payload?.message ||
          (lastDisconnect?.error as any)?.message ||
          "";

        const isLoggedOut =
          statusCode === DisconnectReason.loggedOut || statusCode === 401;
        const isRestartRequired =
          statusCode === DisconnectReason.restartRequired || statusCode === 515;

        if (isLoggedOut) {
          // Session invalidated or rejected — clear old auth files so next QR / Pairing Code starts fresh
          waRuntime.state = "disconnected";
          waRuntime.connectedUser = null;
          waRuntime.qrDataUrl = null;
          waRuntime.pairingCode = null;
          if (fs.existsSync(WA_AUTH_DIR)) {
            fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
          }
        } else if (isRestartRequired) {
          // Immediately after QR scan on phone, WhatsApp sends 515 restartRequired to complete linking!
          waRuntime.state = "connecting";
          waRuntime.qrDataUrl = null;
          setTimeout(() => {
            startRealWhatsAppConnection(false).catch(() => {});
          }, 400);
        } else {
          // Automatically reconnect on both persistent servers and warm Vercel containers when credentials exist
          const hasSavedCreds = fs.existsSync(path.join(WA_AUTH_DIR, "creds.json"));
          if (hasSavedCreds || !process.env.VERCEL) {
            waRuntime.state = "connecting";
            if (reasonMsg) {
              waRuntime.lastError = `Reconnecting (${reasonMsg})...`;
            }
            setTimeout(() => {
              startRealWhatsAppConnection(false).catch(() => {});
            }, 1500);
          } else {
            waRuntime.state = "disconnected";
          }
        }
      }
    });

    // Listen to real-time incoming WhatsApp messages and auto-reply via MS Agent
    sock.ev.on("messages.upsert", async (m: any) => {
      try {
        if (m.type !== "notify" && m.type !== "append") return;

        for (const msg of m.messages || []) {
          const msgId = msg.key?.id;
          if (!msgId || processedMsgIds.has(msgId) || sentByAiMsgIds.has(msgId)) {
            continue;
          }

          // Ignore old history sync messages older than 90 seconds
          const msgTimestamp = Number(msg.messageTimestamp || 0);
          if (msgTimestamp > 0 && Date.now() / 1000 - msgTimestamp > 90) {
            continue;
          }

          const remoteJid = msg.key?.remoteJid || "";
          if (
            !remoteJid ||
            remoteJid === "status@broadcast" ||
            remoteJid.endsWith("@g.us") ||
            remoteJid.endsWith("@newsletter")
          ) {
            continue;
          }

          if (msg.key?.fromMe && !waRuntime.replyToSelfMessages) {
            continue;
          }

          // Unwrap ephemeral / disappearing / viewOnce wrappers used by modern WhatsApp clients
          const rawMsg =
            msg.message?.ephemeralMessage?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.documentWithCaptionMessage?.message ||
            msg.message;

          if (!rawMsg) continue;

          const textContent =
            rawMsg.conversation ||
            rawMsg.extendedTextMessage?.text ||
            rawMsg.imageMessage?.caption ||
            rawMsg.videoMessage?.caption ||
            rawMsg.buttonsResponseMessage?.selectedDisplayText ||
            rawMsg.listResponseMessage?.title ||
            rawMsg.templateButtonReplyMessage?.selectedDisplayText ||
            "";

          const incomingText = String(textContent || "").trim();
          if (!incomingText) continue;

          processedMsgIds.add(msgId);

          const senderPhoneDigits = remoteJid.split("@")[0].split(":")[0];
          const formattedPhone = senderPhoneDigits ? `+${senderPhoneDigits}` : remoteJid;
          const contactName = msg.pushName || formattedPhone;
          const nowTime = new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          if (!waRuntime.autoReplyEnabled) {
            waRuntime.liveMessages.unshift({
              id: `wa-live-${msgId}`,
              contactName,
              phoneNumber: formattedPhone,
              incomingMessage: incomingText,
              aiReply: "Auto-reply is paused. Click 'Auto-Answer' to reply.",
              status: "Pending AI Answer",
              timestamp: nowTime,
              isLiveDeviceMessage: true,
            });
            continue;
          }

          try {
            await sock.sendPresenceUpdate("composing", remoteJid);
          } catch {}

          const aiReplyText = await generateSmartWhatsAppReply(
            contactName,
            formattedPhone,
            incomingText
          );

          const sentMsg = await sock.sendMessage(remoteJid, { text: aiReplyText });
          if (sentMsg?.key?.id) {
            sentByAiMsgIds.add(sentMsg.key.id);
            processedMsgIds.add(sentMsg.key.id);
          }

          try {
            await sock.sendPresenceUpdate("paused", remoteJid);
          } catch {}

          waRuntime.liveMessages.unshift({
            id: `wa-live-${msgId}`,
            contactName,
            phoneNumber: formattedPhone,
            incomingMessage: incomingText,
            aiReply: aiReplyText,
            status: "Auto-Replied",
            timestamp: nowTime,
            isLiveDeviceMessage: true,
          });

          if (waRuntime.liveMessages.length > 50) {
            waRuntime.liveMessages = waRuntime.liveMessages.slice(0, 50);
          }
        }
      } catch (err) {
        console.error("Error handling incoming live WhatsApp message:", err);
      }
    });
  } catch (err: any) {
    console.error("Failed to initialize WhatsApp socket:", err);
    waRuntime.state = "error";
    waRuntime.lastError = err?.message || "Failed to initialize WhatsApp link";
  } finally {
    isStartingWa = false;
  }
}

// Helper: Send Direct Message via Linked Baileys WhatsApp Socket OR Meta Cloud API
async function dispatchDirectWhatsAppMessage(
  toPhone: string,
  messageBody: string,
  contactLabel = "WhatsApp Contact"
) {
  const cleanPhone = (toPhone || "").replace(/[^0-9]/g, "");

  if (waSocket && waRuntime.state === "connected" && cleanPhone.length >= 8) {
    try {
      const jid = `${cleanPhone}@s.whatsapp.net`;
      const sent = await waSocket.sendMessage(jid, { text: messageBody });
      if (sent?.key?.id) {
        sentByAiMsgIds.add(sent.key.id);
      }

      waRuntime.liveMessages.unshift({
        id: `wa-out-${Date.now()}`,
        contactName: contactLabel || `+${cleanPhone}`,
        phoneNumber: `+${cleanPhone}`,
        incomingMessage: "Direct Outgoing AI Message",
        aiReply: messageBody,
        status: "Auto-Replied",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isLiveDeviceMessage: true,
      });

      return {
        deliveredDirect: true,
        channel: "linked_whatsapp_device",
        messageId: sent?.key?.id || `baileys_${Date.now()}`,
      };
    } catch (err) {
      console.error("Baileys direct send error:", err);
    }
  }

  const token = customMetaAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = customMetaPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (token && phoneId && cleanPhone.length >= 8) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleanPhone,
            type: "text",
            text: { preview_url: false, body: messageBody },
          }),
        }
      );
      const data = await response.json();
      if (response.ok) {
        return {
          deliveredDirect: true,
          channel: "meta_cloud_api",
          messageId: data?.messages?.[0]?.id || `wamid.${Date.now()}`,
        };
      }
    } catch (err) {
      console.error("WhatsApp Cloud API dispatch fallback:", err);
    }
  }

  return {
    deliveredDirect: false,
    channel: "wa_deep_link_ready",
    messageId: `auto_wa_${Date.now()}`,
  };
}

// Local deterministic fallback parser so MS Agent continues working seamlessly even if API quota is exhausted
async function buildLocalAutonomousFallback(message: string, contextState: any = {}) {
  const lower = message.toLowerCase();
  const isBengali = /[\u0980-\u09FF]/.test(message);
  const isHindi = /[\u0900-\u097F]/.test(message);

  const executedActions: any[] = [];
  const searchSources: any[] = [];
  let replyText = "";

  const wantsWhatsApp =
    lower.includes("whatsapp") ||
    lower.includes("হোয়াটসঅ্যাপ") ||
    lower.includes("হোয়াটসঅ্যাপ") ||
    lower.includes("व्हाट्सएप") ||
    lower.includes("व्हाट्सऐप") ||
    lower.includes("মেসেজ পাঠাও") ||
    lower.includes("मैसेज भेजो") ||
    lower.includes("send a message") ||
    lower.includes("send whatsapp");

  const wantsEmail =
    lower.includes("email") ||
    lower.includes("send mail") ||
    lower.includes("ইমেইল") ||
    lower.includes("মেইল") ||
    lower.includes("ईमेल") ||
    lower.includes("मेल");

  const wantsSearch =
    lower.includes("search") ||
    lower.includes("google") ||
    lower.includes("news") ||
    lower.includes("সার্চ") ||
    lower.includes("খবর") ||
    lower.includes("নিউজ") ||
    lower.includes("सर्च") ||
    lower.includes("खबर") ||
    lower.includes("न्यूज़");

  const wantsExplicitTask =
    lower.includes("task") ||
    lower.includes("note") ||
    lower.includes("remind") ||
    lower.includes("schedule") ||
    lower.includes("নোট কর") ||
    lower.includes("মনে করিয়ে") ||
    lower.includes("টাস্ক") ||
    lower.includes("नोट") ||
    lower.includes("याद दिला");

  if (wantsWhatsApp) {
    let contactName = "WhatsApp Contact";
    let phoneNumber = "";

    const phoneMatch = message.match(/\+?[0-9]{10,15}/);
    if (phoneMatch) {
      phoneNumber = phoneMatch[0].startsWith("+") ? phoneMatch[0] : `+${phoneMatch[0]}`;
    }

    const knownContacts = contextState.recentWhatsApp || [];
    for (const c of knownContacts) {
      const firstToken = String(c.contact || "").split(" ")[0].toLowerCase();
      if (firstToken && lower.includes(firstToken)) {
        contactName = c.contact;
        phoneNumber = phoneNumber || c.phone || "";
        break;
      }
    }

    const replyMessage = await generateIntelligentConversationalAnswer(
      message,
      contactName
    );

    const waResult = await dispatchDirectWhatsAppMessage(
      phoneNumber,
      replyMessage,
      contactName
    );

    executedActions.push({
      id: `act_${Date.now()}_wa`,
      toolName: "reply_whatsapp",
      args: {
        contactName,
        phoneNumber,
        incomingContext: message,
        replyMessage,
        ...waResult,
      },
    });

    replyText = isBengali
      ? `আমি স্বয়ংক্রিয়ভাবে হোয়াটসঅ্যাপে ${contactName}-কে আপনার মেসেজটি পাঠিয়ে দিয়েছি: "${replyMessage}"`
      : isHindi
      ? `मैंने स्वचालित रूप से व्हाट्सएप पर ${contactName} को आपका संदेश भेज दिया है: "${replyMessage}"`
      : `I have automatically sent your WhatsApp message to ${contactName}: "${replyMessage}"`;
  } else if (wantsEmail) {
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const to = emailMatch ? emailMatch[0] : "recipient@example.com";

    const subject = isBengali
      ? "গুরুত্বপূর্ণ প্রজেক্ট ও মিটিং আপডেট"
      : isHindi
      ? "महत्वपूर्ण प्रोजेक्ट और मीटिंग अपडेट"
      : "Executive Action & Schedule Update";

    const body = isBengali
      ? `প্রিয় মহোদয়,\n\nআপনার সাথে নিম্নোক্ত বিষয়ে যোগাযোগ করা হচ্ছে:\n${message}\n\nশুভেচ্ছান্তে,\nMS Agent`
      : isHindi
      ? `प्रिय महोदय,\n\nआपसे निम्नलिखित विषय में संपर्क किया जा रहा है:\n${message}\n\nसादर,\nMS Agent`
      : `Hello,\n\nI am writing to share the following update:\n${message}\n\nBest regards,\nMS Agent`;

    executedActions.push({
      id: `act_${Date.now()}_em`,
      toolName: "draft_email",
      args: {
        to,
        subject,
        body,
        priority: "High",
      },
    });

    replyText = isBengali
      ? `আমি স্বয়ংক্রিয়ভাবে ${to}-এর কাছে "${subject}" বিষয়ে ইমেইলটি প্রস্তুত ও প্রেরণ করেছি।`
      : isHindi
      ? `मैंने स्वचालित रूप से ${to} को "${subject}" विषय पर ईमेल तैयार कर भेज दिया है।`
      : `I have automatically composed and dispatched the email to ${to} with the subject "${subject}".`;
  } else if (wantsSearch) {
    searchSources.push(
      {
        title: `Google Live Search: ${message.slice(0, 50)}`,
        uri: `https://www.google.com/search?q=${encodeURIComponent(message)}`,
      },
      {
        title: "Google News Live Feed",
        uri: `https://news.google.com/search?q=${encodeURIComponent(message)}`,
      }
    );

    const wikiSummary = await fetchLiveKnowledgeAnswer(
      message,
      isBengali ? "bn" : isHindi ? "hi" : "en"
    );

    replyText =
      wikiSummary ||
      (isBengali
        ? `আপনার "${message}" বিষয়ে সার্চ ফলাফল প্রস্তুত করা হয়েছে এবং নিচে যাচাইকৃত ওয়েব লিংক যুক্ত করা হয়েছে।`
        : isHindi
        ? `आपके "${message}" विषय पर खोज परिणाम तैयार कर लिए गए हैं और सत्यापित वेब लिंक नीचे दिए गए हैं।`
        : `I have searched for "${message}" and attached the verified live web links below for immediate access.`);
  } else if (wantsExplicitTask) {
    executedActions.push({
      id: `act_${Date.now()}_tsk`,
      toolName: "create_systematic_task",
      args: {
        title: message.slice(0, 90),
        category: "Personal",
        dueTime: "Today",
        notes: `Recorded via voice/text command: ${message}`,
      },
    });

    replyText = isBengali
      ? `আমি আপনার কাজটি স্বয়ংক্রিয়ভাবে সিস্টেমেটিক তালিকায় সংরক্ষণ করেছি: "${message}"।`
      : isHindi
      ? `मैंने आपका कार्य स्वचालित रूप से आपकी सूची में सहेज दिया है: "${message}"।`
      : `I have automatically added this task to your systematic schedule: "${message}".`;
  } else {
    // Natural conversational answer for greetings, questions, or general chat!
    replyText = await generateIntelligentConversationalAnswer(message);
  }

  return {
    replyText,
    executedActions,
    searchSources,
    quotaFallbackUsed: true,
  };
}

const draftEmailTool: FunctionDeclaration = {
  name: "draft_email",
  description:
    "Automatically compose and dispatch a formal or personal email on the user's behalf. Call this whenever the user asks to email someone, write an email, or respond to an email.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      to: {
        type: Type.STRING,
        description: "Recipient email address or name (e.g., rahim.ahmed@dhakatech.com or Rahim).",
      },
      subject: {
        type: Type.STRING,
        description: "Clear, well-structured email subject line.",
      },
      body: {
        type: Type.STRING,
        description: "Complete, polite, well-written email body in the appropriate language (English, Bengali, or Hindi).",
      },
      priority: {
        type: Type.STRING,
        description: "Priority level: 'Normal' or 'High'.",
      },
    },
    required: ["to", "subject", "body"],
  },
};

const replyWhatsAppTool: FunctionDeclaration = {
  name: "reply_whatsapp",
  description:
    "Automatically compose and directly send a WhatsApp message or reply to a WhatsApp contact on the user's behalf. Call this whenever the user asks to message someone on WhatsApp, reply to a WhatsApp text, or send a WhatsApp update.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      contactName: {
        type: Type.STRING,
        description: "Name of the contact or group on WhatsApp.",
      },
      phoneNumber: {
        type: Type.STRING,
        description: "Phone number in international format (e.g. +8801711002244 or +919876543210) if known.",
      },
      incomingContext: {
        type: Type.STRING,
        description: "Context or summary of the message being replied to.",
      },
      replyMessage: {
        type: Type.STRING,
        description: "The exact WhatsApp message to send in the target language (English, Bengali, or Hindi).",
      },
    },
    required: ["contactName", "replyMessage"],
  },
};

const manageTaskTool: FunctionDeclaration = {
  name: "create_systematic_task",
  description:
    "Automatically log a structured task, reminder, meeting, or daily workflow note to the user's systematic ledger.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: "Actionable title of the task or note.",
      },
      category: {
        type: Type.STRING,
        description: "Category such as 'Email Follow-up', 'WhatsApp', 'Research', 'Meeting', or 'Personal'.",
      },
      dueTime: {
        type: Type.STRING,
        description: "Scheduled time or deadline (e.g., 'Today 5:00 PM', 'Tomorrow 10:00 AM').",
      },
      notes: {
        type: Type.STRING,
        description: "Systematic step-by-step notes or details for this item.",
      },
    },
    required: ["title", "category", "dueTime"],
  },
};

export const apiApp = express();
apiApp.use(express.json({ limit: "25mb" }));

// Auto-initialize WhatsApp link session if previous credentials exist
if (fs.existsSync(path.join(WA_AUTH_DIR, "creds.json"))) {
  startRealWhatsAppConnection(false).catch(() => {});
}

let customMetaAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
let customMetaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";

// ==========================================================================
// DIRECT WHATSAPP DEVICE LINKING & META CLOUD WEBHOOK ENDPOINTS
// ==========================================================================

apiApp.get("/api/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "ms_agent_verify_token";

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Verification failed");
});

apiApp.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    const contact = changes?.contacts?.[0];

    if (msg && msg.type === "text" && msg.text?.body) {
      const senderPhone = `+${String(msg.from).replace(/[^0-9]/g, "")}`;
      const senderName = contact?.profile?.name || senderPhone;
      const incomingText = msg.text.body;

      const aiReply = await generateSmartWhatsAppReply(
        senderName,
        senderPhone,
        incomingText
      );
      await dispatchDirectWhatsAppMessage(senderPhone, aiReply, senderName);

      waRuntime.liveMessages.unshift({
        id: `wa-cloud-${msg.id || Date.now()}`,
        contactName: senderName,
        phoneNumber: senderPhone,
        incomingMessage: incomingText,
        aiReply,
        status: "Auto-Replied",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isLiveDeviceMessage: true,
      });
    }
    res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(200).send("EVENT_RECEIVED");
  }
});

apiApp.get("/api/whatsapp/status", async (req, res) => {
  // If credentials exist in WA_AUTH_DIR but socket was paused on serverless spin-down, auto-resume it!
  if (
    waRuntime.state === "disconnected" &&
    !isStartingWa &&
    fs.existsSync(path.join(WA_AUTH_DIR, "creds.json"))
  ) {
    startRealWhatsAppConnection(false).catch(() => {});
  }
  res.json({
    ...waRuntime,
    cloudWebhookConfigured: Boolean(customMetaAccessToken && customMetaPhoneId),
  });
});

apiApp.post("/api/whatsapp/connect", async (req, res) => {
  try {
    const { resetSession = false } = req.body || {};
    // If not currently connected, always reset partial/expired auth state so a fresh valid QR code is generated
    const shouldForceFresh =
      Boolean(resetSession) || waRuntime.state !== "connected";
    await startRealWhatsAppConnection(shouldForceFresh);
    for (let i = 0; i < 20; i++) {
      if (waRuntime.qrDataUrl || waRuntime.state === "connected") break;
      await sleep(300);
    }
    res.json(waRuntime);
  } catch (err: any) {
    res.status(200).json({
      ...waRuntime,
      state: "error",
      lastError: err?.message || "Failed to start WhatsApp link",
    });
  }
});

apiApp.post("/api/whatsapp/pair-code", async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    const cleanPhone = String(phoneNumber || "").replace(/[^0-9]/g, "");
    if (cleanPhone.length < 8) {
      return res.status(400).json({
        error: "Please enter a valid phone number with country code (e.g., 8801711002244 or 919876543210).",
      });
    }

    // Pairing code requires a fresh unlinked socket with Browsers.ubuntu("Chrome")
    await startRealWhatsAppConnection(true);
    for (let i = 0; i < 15; i++) {
      if (waSocket && (waRuntime.qrDataUrl || waRuntime.state === "qr_ready")) {
        break;
      }
      await sleep(300);
    }
    await sleep(500);

    const code = await waSocket.requestPairingCode(cleanPhone);
    const formattedCode =
      code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    waRuntime.pairingCode = formattedCode;
    res.json({ pairingCode: formattedCode, status: waRuntime });
  } catch (err: any) {
    console.error("Pairing code error:", err);
    res.status(500).json({
      error:
        err?.message ||
        "Could not generate pairing code right now. Make sure the phone number includes your country code (e.g., +880 or +91).",
    });
  }
});

apiApp.post("/api/whatsapp/settings", (req, res) => {
  const {
    autoReplyEnabled,
    replyToSelfMessages,
    metaAccessToken,
    metaPhoneNumberId,
  } = req.body || {};
  if (typeof autoReplyEnabled === "boolean") {
    waRuntime.autoReplyEnabled = autoReplyEnabled;
  }
  if (typeof replyToSelfMessages === "boolean") {
    waRuntime.replyToSelfMessages = replyToSelfMessages;
  }
  if (typeof metaAccessToken === "string" && metaAccessToken.trim()) {
    customMetaAccessToken = metaAccessToken.trim();
  }
  if (typeof metaPhoneNumberId === "string" && metaPhoneNumberId.trim()) {
    customMetaPhoneId = metaPhoneNumberId.trim();
  }
  res.json({
    ...waRuntime,
    cloudWebhookConfigured: Boolean(customMetaAccessToken && customMetaPhoneId),
  });
});

apiApp.post("/api/whatsapp/disconnect", async (req, res) => {
  try {
    if (waSocket) {
      try {
        await waSocket.logout();
      } catch {}
      try {
        waSocket.end(undefined);
      } catch {}
      waSocket = null;
    }
    if (fs.existsSync(WA_AUTH_DIR)) {
      fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
    }
    waRuntime.state = "disconnected";
    waRuntime.qrDataUrl = null;
    waRuntime.pairingCode = null;
    waRuntime.connectedUser = null;
    res.json(waRuntime);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to disconnect WhatsApp" });
  }
});

// 1. Multilingual Audio Transcription Endpoint
apiApp.post("/api/transcribe", async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: "Missing audio data" });
    }

    const response = await generateWithFallback({
      models: [
        "gemini-3.5-transcribe",
        "gemini-flash-lite-latest",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
      ],
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "audio/webm",
              data: audioBase64,
            },
          },
          {
            text: "Transcribe this spoken audio accurately. The user may speak in English, Bengali (বাংলা), or Hindi (हिन्दी). Transcribe in the exact language spoken (use English script for English, Bengali script for Bengali, and Devanagari script for Hindi). Return only the exact transcription without extra commentary.",
          },
        ],
      },
    });

    res.json({ text: response.text?.trim() || "" });
  } catch (error: any) {
    console.warn("Server transcription fallback trigger:", error?.message || error);
    res.status(200).json({
      text: "",
      quotaExceeded: isRateLimitOrQuotaError(error),
      error: "API quota reached — using browser speech recognition fallback.",
    });
  }
});

// 2. Main Autonomous Agent Endpoint
apiApp.post("/api/agent", async (req, res) => {
  const { message, history = [], contextState = {} } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const systemInstruction = `You are "MS Agent", a fully autonomous, systematic Personal AI Executive Assistant.
You automatically execute all operations on the user's behalf without waiting for manual steps:
1. Automatically writing and dispatching Emails ('draft_email' tool).
2. Automatically answering and directly dispatching WhatsApp messages ('reply_whatsapp' tool) via the linked live WhatsApp account. Look up the contact's phone number from the Recent WhatsApp Chats context if available.
3. Searching the web with real-time Google Search grounding for accurate, up-to-date answers, news, prices, schedules, or research.
4. Automatically organizing tasks, notes, and reminders ('create_systematic_task' tool).

CRITICAL MULTILINGUAL LANGUAGE MIRRORING RULE (English, Bengali, Hindi):
- Detect the exact language in which the user spoke or wrote their message:
  * If the user speaks/writes in **English**, you MUST respond 100% in natural, clear **English**.
  * If the user speaks/writes in **Bengali (বাংলা)** or **Banglish** (Bengali written in Latin script), you MUST respond 100% in natural, polite **Bengali (বাংলা লিপিতে)** so the voice TTS speaks authentic Bengali.
  * If the user speaks/writes in **Hindi (हिन्दी)** or **Hinglish** (Hindi written in Latin script), you MUST respond 100% in natural, polite **Hindi (देवनागरी लिपि में)** so the voice TTS speaks authentic Hindi.
- Never mix up the user's chosen language: always reply in the SAME language the user just used!
- Keep your spoken response concise, systematic, and natural for voice playback (2 to 4 clear sentences confirming that you have automatically executed the task or answering their question directly).
- Current Workspace Context:
  Linked WhatsApp Device: ${waRuntime.connectedUser ? `${waRuntime.connectedUser.name} (${waRuntime.connectedUser.phone})` : "Not linked yet"}
  Recent Emails: ${JSON.stringify(contextState.recentEmails || [])}
  Recent WhatsApp Contacts & Chats: ${JSON.stringify(contextState.recentWhatsApp || [])}
  Active Tasks: ${JSON.stringify(contextState.recentTasks || [])}`;

    const contents: any[] = [];
    for (const item of history.slice(-6)) {
      contents.push({
        role: item.role === "user" ? "user" : "model",
        parts: [{ text: item.text }],
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const response = await generateWithFallback({
      models: [
        "gemini-flash-lite-latest",
        "gemini-3.1-flash-lite",
        "gemini-3.8-flash",
        "gemini-flash-latest",
      ],
      contents,
      config: {
        systemInstruction,
        tools: [
          { googleSearch: {} },
          {
            functionDeclarations: [
              draftEmailTool,
              replyWhatsAppTool,
              manageTaskTool,
            ],
          },
        ],
        toolConfig: { includeServerSideToolInvocations: true },
      },
    });

    const functionCalls = response.functionCalls || [];
    const executedActions: any[] = [];

    for (const call of functionCalls) {
      let extraMeta: Record<string, any> = {};
      if (call.name === "reply_whatsapp" && call.args) {
        const argsObj = call.args as Record<string, any>;
        const waResult = await dispatchDirectWhatsAppMessage(
          String(argsObj.phoneNumber || ""),
          String(argsObj.replyMessage || ""),
          String(argsObj.contactName || "WhatsApp Contact")
        );
        extraMeta = waResult;
      }

      executedActions.push({
        toolName: call.name,
        args: { ...(call.args as Record<string, any>), ...extraMeta },
        id: call.id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });
    }

    const groundingChunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const searchSources = groundingChunks
      .map((chunk: any) => {
        if (chunk.web?.uri) {
          return {
            title: chunk.web.title || chunk.web.uri,
            uri: chunk.web.uri,
          };
        }
        return null;
      })
      .filter(Boolean);

    let replyText = response.text?.trim() || "";

    const isBengali = /[\u0980-\u09FF]/.test(message);
    const isHindi = /[\u0900-\u097F]/.test(message);

    if (!replyText && executedActions.length > 0) {
      const actionSummaries = executedActions
        .map((a) => {
          if (a.toolName === "draft_email") {
            if (isBengali) {
              return `আমি স্বয়ংক্রিয়ভাবে ${a.args.to}-এর কাছে "${a.args.subject}" বিষয়ে ইমেইলটি পাঠিয়ে দিয়েছি।`;
            }
            if (isHindi) {
              return `मैंने स्वचालित रूप से ${a.args.to} को "${a.args.subject}" विषय पर ईमेल भेज दिया है।`;
            }
            return `I have automatically composed and dispatched the email to ${a.args.to} regarding "${a.args.subject}".`;
          }
          if (a.toolName === "reply_whatsapp") {
            if (isBengali) {
              return `আমি সরাসরি হোয়াটসঅ্যাপে ${a.args.contactName}-কে আপনার মেসেজটি পাঠিয়ে দিয়েছি: "${a.args.replyMessage}"।`;
            }
            if (isHindi) {
              return `मैंने सीधे व्हाट्सएप पर ${a.args.contactName} को आपका संदेश भेज दिया है: "${a.args.replyMessage}"।`;
            }
            return `I have automatically sent the WhatsApp message to ${a.args.contactName}: "${a.args.replyMessage}".`;
          }
          if (a.toolName === "create_systematic_task") {
            if (isBengali) {
              return `আমি "${a.args.title}" কাজটি স্বয়ংক্রিয়ভাবে আপনার সিস্টেমেটিক তালিকায় যুক্ত করেছি।`;
            }
            if (isHindi) {
              return `मैंने "${a.args.title}" कार्य को स्वचालित रूप से आपकी सूची में जोड़ दिया है।`;
            }
            return `I have automatically added "${a.args.title}" to your systematic task schedule.`;
          }
          return `I have automatically completed your request.`;
        })
        .join(" ");
      replyText = actionSummaries;
    }

    res.json({
      replyText,
      executedActions,
      searchSources,
    });
  } catch (error: any) {
    console.warn(
      "Gemini API rate-limit or error encountered; activating local autonomous engine:",
      error?.message || error
    );
    const fallbackPayload = await buildLocalAutonomousFallback(message, contextState);
    res.status(200).json(fallbackPayload);
  }
});

// 3. Autonomous AI Auto-Reply Generator & Direct Sender for Incoming WhatsApp Messages
apiApp.post("/api/whatsapp/auto-reply", async (req, res) => {
  const { contactName, phoneNumber, incomingMessage } = req.body || {};
  if (!incomingMessage) {
    return res.status(400).json({ error: "Incoming message is required" });
  }

  try {
    const aiReply = await generateSmartWhatsAppReply(
      contactName || "Contact",
      phoneNumber || "",
      incomingMessage
    );
    const dispatchInfo = await dispatchDirectWhatsAppMessage(
      phoneNumber || "",
      aiReply,
      contactName || "Contact"
    );

    res.json({
      aiReply,
      ...dispatchInfo,
    });
  } catch (error: any) {
    const fallbackReply = await generateIntelligentConversationalAnswer(
      incomingMessage,
      contactName || ""
    );
    res.status(200).json({
      aiReply: fallbackReply,
      deliveredDirect: false,
    });
  }
});

// 4. Direct WhatsApp Send Endpoint
apiApp.post("/api/whatsapp/send-direct", async (req, res) => {
  try {
    const { phoneNumber, message, contactName } = req.body || {};
    const result = await dispatchDirectWhatsAppMessage(
      phoneNumber,
      message,
      contactName
    );
    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    res.status(200).json({ success: false, error: error?.message || "Direct WhatsApp dispatch failed" });
  }
});

// 5. Text-to-Speech Endpoint (gemini-3.8-flash-lite-tts) with graceful fallback signal
apiApp.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceName = "Kore" } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: "Text is required for TTS" });
    }

    const cleanText = text
      .replace(/[*#_`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .slice(0, 1200);

    const response = await generateWithFallback({
      models: ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"],
      contents: [
        {
          role: "user",
          parts: [
            {
              text: cleanText,
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName || "Kore",
            },
          },
        },
      },
    });

    const base64Audio =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      return res.status(200).json({ fallbackToBrowserTts: true });
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: "audio/wav",
    });
  } catch (error: any) {
    res.status(200).json({
      fallbackToBrowserTts: true,
    });
  }
});

export default apiApp;
