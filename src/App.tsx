import React, { useState, useRef, useEffect } from "react";
import {
  Mic,
  Square,
  Volume2,
  VolumeX,
  Send,
  ExternalLink,
  Plus,
  Check,
  Trash2,
  RefreshCw,
  ArrowUpRight,
  Play,
  Pause,
  QrCode,
  Smartphone,
  Power,
} from "lucide-react";
import {
  WorkspaceTab,
  VoiceOption,
  EmailItem,
  WhatsAppItem,
  WhatsAppConnectionStatus,
  SearchRecord,
  SystematicTask,
  ConversationMessage,
  ExecutedAction,
} from "./types";
import {
  INITIAL_EMAILS,
  INITIAL_WHATSAPP,
  INITIAL_TASKS,
  INITIAL_SEARCHES,
  INITIAL_MESSAGES,
  QUICK_VOICE_PROMPTS,
} from "./initialData";

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("command");
  const [emails, setEmails] = useState<EmailItem[]>(() => {
    const saved = localStorage.getItem("ms_agent_emails_v3");
    return saved ? JSON.parse(saved) : INITIAL_EMAILS;
  });
  const [whatsapps, setWhatsapps] = useState<WhatsAppItem[]>(() => {
    const saved = localStorage.getItem("ms_agent_whatsapps_v3");
    return saved ? JSON.parse(saved) : INITIAL_WHATSAPP;
  });
  const [tasks, setTasks] = useState<SystematicTask[]>(() => {
    const saved = localStorage.getItem("ms_agent_tasks_v3");
    return saved ? JSON.parse(saved) : INITIAL_TASKS;
  });
  const [searches, setSearches] = useState<SearchRecord[]>(() => {
    const saved = localStorage.getItem("ms_agent_searches_v3");
    return saved ? JSON.parse(saved) : INITIAL_SEARCHES;
  });
  const [messages, setMessages] = useState<ConversationMessage[]>(INITIAL_MESSAGES);

  // Live Real WhatsApp Device Link Status
  const [waStatus, setWaStatus] = useState<WhatsAppConnectionStatus>({
    state: "disconnected",
    qrDataUrl: null,
    pairingCode: null,
    connectedUser: null,
    autoReplyEnabled: true,
    replyToSelfMessages: true,
    lastError: null,
    liveMessages: [],
  });
  const [isConnectingWa, setIsConnectingWa] = useState(false);
  const [pairingPhoneInput, setPairingPhoneInput] = useState("");
  const [isRequestingPairCode, setIsRequestingPairCode] = useState(false);

  // Automation & Voice states
  const [fullAutoPilot, setFullAutoPilot] = useState(true);
  const [autoHandsFreeVoice, setAutoHandsFreeVoice] = useState(true);
  const [directWaPhone, setDirectWaPhone] = useState("");
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>("Kore");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Direct WhatsApp Composer & Auto-Reply Simulator states
  const [quickWaContact, setQuickWaContact] = useState("");
  const [quickWaPhone, setQuickWaPhone] = useState("");
  const [quickWaIncoming, setQuickWaIncoming] = useState("");
  const [isAutoReplyingWa, setIsAutoReplyingWa] = useState(false);

  // Filter / Search states for individual views
  const [emailFilter, setEmailFilter] = useState<
    "all" | "Drafted by AI" | "Dispatched" | "Incoming Needs Reply"
  >("all");
  const [waFilter, setWaFilter] = useState<
    "all" | "Ready to Send" | "Auto-Replied" | "Pending AI Answer"
  >("all");
  const [taskSearch, setTaskSearch] = useState("");

  // Inline form states for manual task additions
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskCategory, setNewTaskCategory] = useState("Personal");
  const [newTaskDue, setNewTaskDue] = useState("Today 6:00 PM");

  // Audio & VAD refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const silenceAnimRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const seenLiveMsgIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem("ms_agent_emails_v3", JSON.stringify(emails));
  }, [emails]);

  useEffect(() => {
    localStorage.setItem("ms_agent_whatsapps_v3", JSON.stringify(whatsapps));
  }, [whatsapps]);

  useEffect(() => {
    localStorage.setItem("ms_agent_tasks_v3", JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("ms_agent_searches_v3", JSON.stringify(searches));
  }, [searches]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // Safe JSON parser so serverless/proxy plain-text errors never crash the UI with "Unexpected token 'A', 'A server e'... is not valid JSON"
  const safeParseJson = async (res: Response): Promise<any> => {
    const raw = await res.text();
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {
        nonJsonError: true,
        error:
          "Serverless backend is initializing or GEMINI_API_KEY is not set in your Vercel Environment Variables.",
      };
    }
  };

  // Poll Real WhatsApp Link status & sync live incoming/auto-replied device messages
  useEffect(() => {
    let active = true;
    const fetchWaStatus = async () => {
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok || !active) return;
        const data = await safeParseJson(res);
        if (data.nonJsonError) return;
        setWaStatus(data as WhatsAppConnectionStatus);

        if (data.liveMessages && data.liveMessages.length > 0) {
          setWhatsapps((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const newItems = data.liveMessages.filter((m: any) => !existingIds.has(m.id));
            if (newItems.length === 0) return prev;
            return [...newItems, ...prev];
          });

          for (const liveMsg of data.liveMessages) {
            if (!seenLiveMsgIdsRef.current.has(liveMsg.id)) {
              seenLiveMsgIdsRef.current.add(liveMsg.id);
            }
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };

    fetchWaStatus();
    const interval = window.setInterval(fetchWaStatus, 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const handleConnectRealWhatsApp = async (resetSession = false) => {
    setIsConnectingWa(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetSession }),
      });
      const data = await safeParseJson(res);
      if (!res.ok || data.nonJsonError) {
        throw new Error(data.error || "Could not start WhatsApp link");
      }
      setWaStatus(data);
    } catch (err: any) {
      setErrorBanner(err?.message || "Failed to initialize WhatsApp QR link.");
    } finally {
      setIsConnectingWa(false);
    }
  };

  const handleRequestPairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingPhoneInput.trim() || isRequestingPairCode) return;
    setIsRequestingPairCode(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/whatsapp/pair-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: pairingPhoneInput }),
      });
      const data = await safeParseJson(res);
      if (!res.ok || data.nonJsonError) {
        throw new Error(data.error || "Could not generate pairing code");
      }
      if (data.status) setWaStatus(data.status);
    } catch (err: any) {
      setErrorBanner(err?.message || "Failed to request WhatsApp pairing code.");
    } finally {
      setIsRequestingPairCode(false);
    }
  };

  const handleDisconnectRealWhatsApp = async () => {
    try {
      const res = await fetch("/api/whatsapp/disconnect", { method: "POST" });
      if (res.ok) {
        const data = await safeParseJson(res);
        if (!data.nonJsonError) setWaStatus(data);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || "Failed to disconnect WhatsApp.");
    }
  };

  const handleToggleWaSettings = async (
    nextAutoReply: boolean,
    nextReplySelf: boolean
  ) => {
    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoReplyEnabled: nextAutoReply,
          replyToSelfMessages: nextReplySelf,
        }),
      });
      if (res.ok) {
        const data = await safeParseJson(res);
        if (!data.nonJsonError) setWaStatus(data);
      }
    } catch {}
  };

  const detectTextLocale = (text: string): "bn-BD" | "hi-IN" | "en-US" => {
    if (/[\u0980-\u09FF]/.test(text)) return "bn-BD";
    if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
    return "en-US";
  };

  const stopAudioPlayback = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setPlayingMessageId(null);
  };

  const speakResponse = async (text: string, messageId: string, cachedBase64?: string) => {
    stopAudioPlayback();
    setIsSpeaking(true);
    setPlayingMessageId(messageId);

    try {
      let base64Audio = cachedBase64;

      if (!base64Audio) {
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceName: selectedVoice }),
        });

        if (ttsRes.ok) {
          const ttsData = await safeParseJson(ttsRes);
          base64Audio = ttsData.audioBase64;
          if (base64Audio) {
            setMessages((prev) =>
              prev.map((m) => (m.id === messageId ? { ...m, audioBase64: base64Audio } : m))
            );
          }
        }
      }

      if (base64Audio) {
        const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
        currentAudioRef.current = audio;
        audio.onended = () => {
          setIsSpeaking(false);
          setPlayingMessageId(null);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          setPlayingMessageId(null);
        };
        await audio.play();
        return;
      }
    } catch (err) {
      console.error("Server TTS fallback to browser speech:", err);
    }

    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = detectTextLocale(text);
      utterance.onend = () => {
        setIsSpeaking(false);
        setPlayingMessageId(null);
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setPlayingMessageId(null);
      };
      window.speechSynthesis.speak(utterance);
    } else {
      setIsSpeaking(false);
      setPlayingMessageId(null);
    }
  };

  const applyExecutedActions = (
    actions: ExecutedAction[],
    userQuery: string,
    replyText: string,
    searchSources: any[]
  ) => {
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    for (const action of actions) {
      if (action.toolName === "draft_email") {
        const newEmail: EmailItem = {
          id: `em-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          to: action.args.to || "recipient@example.com",
          subject: action.args.subject || "Executive Update",
          body: action.args.body || "",
          priority: action.args.priority === "High" ? "High" : "Normal",
          status: fullAutoPilot ? "Dispatched" : "Drafted by AI",
          timestamp: nowTime,
        };
        setEmails((prev) => [newEmail, ...prev]);
      } else if (action.toolName === "reply_whatsapp") {
        const matchedContact = whatsapps.find((w) =>
          w.contactName.toLowerCase().includes(String(action.args.contactName || "").toLowerCase())
        );
        const resolvedPhone =
          action.args.phoneNumber || matchedContact?.phoneNumber || directWaPhone;

        const newWa: WhatsAppItem = {
          id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          contactName: action.args.contactName || "WhatsApp Contact",
          phoneNumber: resolvedPhone,
          incomingMessage:
            action.args.incomingContext || "Direct Voice / AI Command Dispatch",
          aiReply: action.args.replyMessage || "",
          status: fullAutoPilot ? "Auto-Replied" : "Ready to Send",
          timestamp: nowTime,
          isLiveDeviceMessage: Boolean(action.args.deliveredDirect),
        };
        setWhatsapps((prev) => [newWa, ...prev]);
      } else if (action.toolName === "create_systematic_task") {
        const newTask: SystematicTask = {
          id: `tsk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          title: action.args.title || "Systematic Task",
          category: action.args.category || "Personal",
          dueTime: action.args.dueTime || "Today",
          notes: action.args.notes || "Automatically logged by MS Agent",
          completed: false,
          timestamp: nowTime,
        };
        setTasks((prev) => [newTask, ...prev]);
      }
    }

    if (searchSources && searchSources.length > 0) {
      const newSearch: SearchRecord = {
        id: `srch-${Date.now()}`,
        query: userQuery,
        summary: replyText,
        sources: searchSources,
        timestamp: nowTime,
      };
      setSearches((prev) => [newSearch, ...prev]);
    }
  };

  const sendCommandToAgent = async (textCommand: string, isVoiceInput = false) => {
    const trimmed = textCommand.trim();
    if (!trimmed || isProcessing) return;

    setErrorBanner(null);
    stopAudioPlayback();

    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg: ConversationMessage = {
      id: `msg-u-${Date.now()}`,
      role: "user",
      text: trimmed,
      timestamp: nowTime,
      isVoice: isVoiceInput,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsProcessing(true);
    setStatusMessage("AI Agent is automatically executing your command...");

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages.slice(-6).map((m) => ({
            role: m.role === "user" ? "user" : "model",
            text: m.text,
          })),
          contextState: {
            recentEmails: emails
              .slice(0, 4)
              .map((e) => ({ to: e.to, subject: e.subject, status: e.status })),
            recentWhatsApp: whatsapps.slice(0, 4).map((w) => ({
              contact: w.contactName,
              phone: w.phoneNumber,
              incoming: w.incomingMessage,
            })),
            recentTasks: tasks
              .filter((t) => !t.completed)
              .slice(0, 4)
              .map((t) => ({ title: t.title, due: t.dueTime })),
          },
        }),
      });

      const data = await safeParseJson(response);
      if (!response.ok || data.nonJsonError) {
        throw new Error(data.error || "Failed to execute AI command");
      }

      const executedActions: ExecutedAction[] = data.executedActions || [];
      const searchSources = data.searchSources || [];
      const replyText =
        data.replyText || "I have automatically executed your request.";

      applyExecutedActions(executedActions, trimmed, replyText, searchSources);

      const assistantMsgId = `msg-a-${Date.now()}`;
      const assistantMsg: ConversationMessage = {
        id: assistantMsgId,
        role: "assistant",
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        executedActions,
        searchSources,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsProcessing(false);
      setStatusMessage("");

      if (autoSpeak) {
        await speakResponse(replyText, assistantMsgId);
      }
    } catch (error: any) {
      console.error("Agent execution error:", error);
      setErrorBanner(error?.message || "Unable to reach the AI Agent right now.");
      setIsProcessing(false);
      setStatusMessage("");
    }
  };

  const cleanupRecordingTimers = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (silenceAnimRef.current) {
      window.cancelAnimationFrame(silenceAnimRef.current);
      silenceAnimRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const speechRecRef = useRef<any>(null);
  const browserTranscriptRef = useRef<string>("");

  const stopVoiceRecording = () => {
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const startVoiceRecording = async () => {
    setErrorBanner(null);
    stopAudioPlayback();
    browserTranscriptRef.current = "";

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionAPI) {
      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let combined = "";
          for (let i = 0; i < event.results.length; i++) {
            combined += event.results[i][0].transcript + " ";
          }
          browserTranscriptRef.current = combined.trim();
        };
        recognition.start();
        speechRecRef.current = recognition;
      } catch {}
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        cleanupRecordingTimers();
        if (speechRecRef.current) {
          try {
            speechRecRef.current.stop();
          } catch {}
          speechRecRef.current = null;
        }
        setRecordingSeconds(0);
        setIsRecording(false);

        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        if (audioBlob.size < 400 && !browserTranscriptRef.current) {
          setStatusMessage("");
          return;
        }

        setIsProcessing(true);
        setStatusMessage("Transcribing your voice (English / বাংলা / हिन्दी)...");

        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64String = (reader.result as string).split(",")[1];
            const transRes = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audioBase64: base64String,
                mimeType: mediaRecorder.mimeType || "audio/webm",
              }),
            });

            const transData = await safeParseJson(transRes);
            const spokenText =
              transData.text?.trim() || browserTranscriptRef.current.trim();

            if (!spokenText) {
              setErrorBanner(
                transData.quotaExceeded
                  ? "API quota reached. Please type your command below or upgrade your API key in Settings > Secrets."
                  : "Could not hear clear speech. Please speak into your microphone again."
              );
              setIsProcessing(false);
              setStatusMessage("");
              return;
            }

            setIsProcessing(false);
            await sendCommandToAgent(spokenText, true);
          };
        } catch (err: any) {
          if (browserTranscriptRef.current.trim()) {
            setIsProcessing(false);
            await sendCommandToAgent(browserTranscriptRef.current.trim(), true);
            return;
          }
          setErrorBanner(err?.message || "Voice transcription encountered an error.");
          setIsProcessing(false);
          setStatusMessage("");
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);

      if (autoHandsFreeVoice) {
        const audioCtx = new AudioContext();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let hasSpoken = false;
        let silenceStart = Date.now();
        const startedAt = Date.now();

        const checkAudioLevel = () => {
          if (mediaRecorder.state === "inactive") return;
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

          if (avg > 14) {
            hasSpoken = true;
            silenceStart = Date.now();
          } else if (hasSpoken && Date.now() - silenceStart > 1800) {
            stopVoiceRecording();
            return;
          } else if (!hasSpoken && Date.now() - startedAt > 8000) {
            stopVoiceRecording();
            return;
          }
          silenceAnimRef.current = window.requestAnimationFrame(checkAudioLevel);
        };
        silenceAnimRef.current = window.requestAnimationFrame(checkAudioLevel);
      }
    } catch (err: any) {
      console.error("Microphone error:", err);
      setErrorBanner(
        "Microphone access denied. Please allow microphone permissions in your browser."
      );
    }
  };

  const handleDispatchEmail = (email: EmailItem) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === email.id ? { ...e, status: "Dispatched" } : e))
    );
  };

  const handleOpenMailto = (email: EmailItem) => {
    const mailtoUrl = `mailto:${encodeURIComponent(email.to)}?subject=${encodeURIComponent(
      email.subject
    )}&body=${encodeURIComponent(email.body)}`;
    window.location.href = mailtoUrl;
    handleDispatchEmail(email);
  };

  const handleSendWhatsApp = async (wa: WhatsAppItem) => {
    setWhatsapps((prev) =>
      prev.map((w) => (w.id === wa.id ? { ...w, status: "Auto-Replied" } : w))
    );
    try {
      await fetch("/api/whatsapp/send-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: wa.phoneNumber,
          message: wa.aiReply,
          contactName: wa.contactName,
        }),
      });
    } catch (e) {
      console.error("Direct WhatsApp API sync error:", e);
    }
  };

  const [metaAccessTokenInput, setMetaAccessTokenInput] = useState("");
  const [metaPhoneIdInput, setMetaPhoneIdInput] = useState("");
  const [metaSavedBanner, setMetaSavedBanner] = useState(false);

  const handleSaveMetaCloudConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/whatsapp/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaAccessToken: metaAccessTokenInput,
          metaPhoneNumberId: metaPhoneIdInput,
        }),
      });
      if (res.ok) {
        const data = await safeParseJson(res);
        if (!data.nonJsonError) setWaStatus(data);
        setMetaSavedBanner(true);
        setTimeout(() => setMetaSavedBanner(false), 3000);
      }
    } catch {}
  };

  const handleSimulateIncomingWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickWaIncoming.trim() || isAutoReplyingWa) return;

    setIsAutoReplyingWa(true);
    const contact = quickWaContact.trim() || "WhatsApp Contact";
    const phone = quickWaPhone.trim() || directWaPhone;
    const incomingText = quickWaIncoming.trim();

    try {
      const res = await fetch("/api/whatsapp/auto-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: contact,
          phoneNumber: phone,
          incomingMessage: incomingText,
        }),
      });
      const data = await safeParseJson(res);
      const isBengali = /[\u0980-\u09FF]/.test(incomingText);
      const isHindi = /[\u0900-\u097F]/.test(incomingText);
      const localFallbackReply = isBengali
        ? `হ্যালো ${contact}! আপনার "${incomingText}" মেসেজটি পেয়েছি, বলুন কীভাবে সাহায্য করতে পারি?`
        : isHindi
        ? `नमस्ते ${contact}! आपके "${incomingText}" संदेश के बारे में मैं आपकी क्या मदद कर सकता हूँ?`
        : `Hello ${contact}! Regarding "${incomingText}" — how can I help you right now?`;

      const generatedReply =
        data.aiReply && !data.nonJsonError ? data.aiReply : localFallbackReply;

      const newWaItem: WhatsAppItem = {
        id: `wa-${Date.now()}`,
        contactName: contact,
        phoneNumber: phone,
        incomingMessage: incomingText,
        aiReply: generatedReply,
        status: "Auto-Replied",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isLiveDeviceMessage: Boolean(data.deliveredDirect),
      };

      setWhatsapps((prev) => [newWaItem, ...prev]);
      setQuickWaIncoming("");
      setQuickWaContact("");

      if (autoSpeak) {
        await speakResponse(generatedReply, newWaItem.id);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || "Failed to auto-reply to WhatsApp message.");
    } finally {
      setIsAutoReplyingWa(false);
    }
  };

  const toggleTaskCompletion = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleAddManualTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const item: SystematicTask = {
      id: `tsk-${Date.now()}`,
      title: newTaskTitle.trim(),
      category: newTaskCategory,
      dueTime: newTaskDue,
      notes: "Added to systematic schedule",
      completed: false,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setTasks((prev) => [item, ...prev]);
    setNewTaskTitle("");
  };

  const filteredEmails =
    emailFilter === "all" ? emails : emails.filter((e) => e.status === emailFilter);

  const filteredWhatsApps =
    waFilter === "all" ? whatsapps : whatsapps.filter((w) => w.status === waFilter);

  const filteredTasks = tasks.filter(
    (t) =>
      t.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
      t.category.toLowerCase().includes(taskSearch.toLowerCase()) ||
      t.notes.toLowerCase().includes(taskSearch.toLowerCase())
  );

  const pendingTaskCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-slate-900 selection:bg-emerald-600 selection:text-white">
      {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav Links | Zone 3 Primary Actions */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-3.5 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <a
          href="#command"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("command");
          }}
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-950 whitespace-nowrap"
        >
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-white flex items-center justify-center text-xs font-mono font-bold shadow-sm">
            MS
          </span>
          <span>MS Agent</span>
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <button
            onClick={() => setActiveTab("command")}
            className={`py-1.5 transition-colors whitespace-nowrap border-b-2 ${
              activeTab === "command"
                ? "border-emerald-600 text-slate-950 font-semibold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Voice Command Hub
          </button>
          <button
            onClick={() => setActiveTab("whatsapp")}
            className={`py-1.5 transition-colors whitespace-nowrap border-b-2 ${
              activeTab === "whatsapp"
                ? "border-emerald-600 text-slate-950 font-semibold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Direct WhatsApp ({waStatus.state === "connected" ? "LIVE" : whatsapps.length})
          </button>
          <button
            onClick={() => setActiveTab("emails")}
            className={`py-1.5 transition-colors whitespace-nowrap border-b-2 ${
              activeTab === "emails"
                ? "border-emerald-600 text-slate-950 font-semibold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Email Desk ({emails.length})
          </button>
          <button
            onClick={() => setActiveTab("search")}
            className={`py-1.5 transition-colors whitespace-nowrap border-b-2 ${
              activeTab === "search"
                ? "border-emerald-600 text-slate-950 font-semibold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Web Search ({searches.length})
          </button>
          <button
            onClick={() => setActiveTab("tasks")}
            className={`py-1.5 transition-colors whitespace-nowrap border-b-2 ${
              activeTab === "tasks"
                ? "border-emerald-600 text-slate-950 font-semibold"
                : "border-transparent hover:text-slate-900"
            }`}
          >
            Tasks & Notes ({pendingTaskCount})
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (isSpeaking) stopAudioPlayback();
              setAutoSpeak(!autoSpeak);
            }}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              autoSpeak
                ? "bg-emerald-50/90 border-emerald-200 text-emerald-900"
                : "bg-white border-slate-200 text-slate-600 hover:text-slate-900"
            }`}
            title="Toggle Automatic Voice Response"
          >
            {autoSpeak ? (
              <Volume2 className="w-3.5 h-3.5 text-emerald-700" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{autoSpeak ? "Auto Voice: ON" : "Auto Voice: Muted"}</span>
          </button>

          <button
            onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
            disabled={isProcessing}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg shadow-sm transition-all whitespace-nowrap ${
              isRecording
                ? "bg-red-600 text-white hover:bg-red-700 ring-4 ring-red-100"
                : "bg-emerald-600 text-white hover:bg-emerald-500"
            } disabled:opacity-50`}
          >
            {isRecording ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span className="font-mono tabular-nums">Listening ({recordingSeconds}s)</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5" />
                <span>Speak Now</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1440px] w-full mx-auto">
        {/* Left Navigation & Autonomous Control Sidebar */}
        <aside className="w-full lg:w-72 shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200/90 p-6 flex flex-col justify-between gap-6">
          <div className="space-y-6">
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-950">
                Autonomous Executive Agent
              </h1>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Speak or type in English, Bengali (বাংলা), or Hindi (हिन्दी). Direct 24/7 WhatsApp AI auto-responder.
              </p>
            </div>

            {/* Interactive Multilingual Voice & Auto-Pilot Box */}
            <div className="p-4 rounded-2xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white shadow-md space-y-3.5 border border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-medium">Multilingual Voice Engine</span>
                <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                  {isRecording
                    ? `REC 00:0${recordingSeconds}`
                    : isSpeaking
                    ? "SPEAKING"
                    : "ONLINE"}
                </span>
              </div>

              <button
                onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                disabled={isProcessing}
                className={`w-full py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all active:scale-[0.99] ${
                  isRecording
                    ? "bg-red-600 hover:bg-red-500 text-white"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                } disabled:opacity-50`}
              >
                {isRecording ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>Listening... Auto-Stop Active</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" />
                    <span>Tap & Speak (EN / বাংলা / हिं)</span>
                  </>
                )}
              </button>

              <div className="pt-1 flex items-center justify-between gap-2 text-xs text-slate-300">
                <label htmlFor="voice-select" className="shrink-0">
                  AI Voice:
                </label>
                <select
                  id="voice-select"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value as VoiceOption)}
                  className="bg-slate-800/90 text-white text-xs rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none focus:border-emerald-500"
                >
                  <option value="Kore">Kore (Natural Multilingual)</option>
                  <option value="Zephyr">Zephyr (Executive Clear)</option>
                  <option value="Puck">Puck (Warm Conversational)</option>
                  <option value="Charon">Charon (Deep Formal)</option>
                  <option value="Fenrir">Fenrir (Crisp Direct)</option>
                </select>
              </div>

              <div className="pt-2.5 border-t border-slate-800/90 space-y-2 text-xs">
                <label className="flex items-center justify-between cursor-pointer text-slate-300">
                  <span>Full Auto-Pilot Execution</span>
                  <input
                    type="checkbox"
                    checked={fullAutoPilot}
                    onChange={(e) => setFullAutoPilot(e.target.checked)}
                    className="rounded border-slate-600 text-emerald-500 focus:ring-0"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer text-slate-300">
                  <span>Auto-Send on Silence</span>
                  <input
                    type="checkbox"
                    checked={autoHandsFreeVoice}
                    onChange={(e) => setAutoHandsFreeVoice(e.target.checked)}
                    className="rounded border-slate-600 text-emerald-500 focus:ring-0"
                  />
                </label>
              </div>
            </div>

            {/* Live WhatsApp Device Connection Status Card */}
            <div className="p-4 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/30 space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">WhatsApp AI Bridge</span>
                <span
                  className={`font-mono tabular-nums font-bold ${
                    waStatus.state === "connected"
                      ? "text-emerald-700"
                      : waStatus.state === "qr_ready"
                      ? "text-amber-700"
                      : "text-slate-500"
                  }`}
                >
                  {waStatus.state === "connected"
                    ? "LIVE CONNECTED"
                    : waStatus.state === "qr_ready"
                    ? "SCAN QR"
                    : waStatus.state.toUpperCase()}
                </span>
              </div>

              {waStatus.state === "connected" && waStatus.connectedUser ? (
                <div className="text-xs text-slate-600 space-y-1">
                  <div className="font-semibold text-slate-900 truncate">
                    {waStatus.connectedUser.name}
                  </div>
                  <div className="font-mono tabular-nums text-emerald-700 font-medium">
                    {waStatus.connectedUser.phone}
                  </div>
                  <div className="text-[11px] text-slate-500 pt-1">
                    Answering all incoming WhatsApp messages with real AI answers.
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-600 leading-relaxed">
                  Link your WhatsApp via QR Code, 8-Digit Pairing Code, or 24/7 Vercel Cloud Webhook.
                </p>
              )}

              <button
                onClick={() => {
                  setActiveTab("whatsapp");
                  if (waStatus.state === "disconnected") {
                    handleConnectRealWhatsApp(false);
                  }
                }}
                className="w-full py-2.5 px-3 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-500 shadow-xs transition-all flex items-center justify-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>
                  {waStatus.state === "connected"
                    ? "Manage Linked WhatsApp"
                    : "Connect WhatsApp Now"}
                </span>
              </button>
            </div>

            {/* Sidebar Section Switcher */}
            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 pb-1.5">
                Workspace Modules
              </div>
              {(
                [
                  { id: "command", label: "01. Voice & Auto-Pilot Hub", count: messages.length },
                  { id: "whatsapp", label: "02. Direct WhatsApp Link", count: whatsapps.length },
                  { id: "emails", label: "03. Automated Email Desk", count: emails.length },
                  { id: "search", label: "04. Live Google Search Desk", count: searches.length },
                  { id: "tasks", label: "05. Daily Notes & Task Ledger", count: tasks.length },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    activeTab === item.id
                      ? "bg-slate-900 text-white font-semibold shadow-xs"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span
                    className={`font-mono tabular-nums ${
                      activeTab === item.id ? "text-emerald-400" : "text-slate-400"
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Clean unboxed operational metrics */}
          <div className="pt-4 border-t border-slate-200 space-y-2 text-xs text-slate-500">
            <div className="flex items-center justify-between">
              <span>Supported Languages</span>
              <span className="text-slate-900 font-semibold">EN · বাংলা · हिन्दी</span>
            </div>
            <div className="flex items-center justify-between">
              <span>WhatsApp Auto-Replied</span>
              <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                {whatsapps.filter((w) => w.status === "Auto-Replied").length} / {whatsapps.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Emails Auto-Dispatched</span>
              <span className="font-mono tabular-nums text-slate-900 font-semibold">
                {emails.filter((e) => e.status === "Dispatched").length} / {emails.length}
              </span>
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 lg:p-8 flex flex-col gap-6 min-w-0">
          {errorBanner && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-4 text-xs text-red-900 shadow-xs">
              <span>{errorBanner}</span>
              <button
                onClick={() => setErrorBanner(null)}
                className="font-semibold underline whitespace-nowrap"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* TAB 1: VOICE & AUTO-PILOT COMMAND CENTER */}
          {activeTab === "command" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
              {/* Left 7 Cols: Voice & Chat Conversation Stream */}
              <section className="xl:col-span-7 bg-white border border-slate-200/90 rounded-2xl shadow-xs flex flex-col h-[700px] overflow-hidden">
                <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 text-white flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold tracking-tight">
                      01. Multilingual Voice & Autonomous Command Hub
                    </h2>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Speak or type in English, Bengali (বাংলা), or Hindi (हिन्दी) — instant intelligent execution & voice answers.
                    </p>
                  </div>
                  {isSpeaking && (
                    <button
                      onClick={stopAudioPlayback}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-400 text-slate-950 rounded-lg flex items-center gap-1.5 whitespace-nowrap shadow-xs"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Stop Voice</span>
                    </button>
                  )}
                </div>

                {/* Message Feed */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/40">
                  {messages.length === 0 && !isProcessing && (
                    <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-12">
                      <div className="w-14 h-14 rounded-2xl bg-emerald-600/10 border border-emerald-500/20 text-emerald-700 flex items-center justify-center">
                        <Mic className="w-6 h-6" />
                      </div>
                      <div className="space-y-1.5">
                        <h3 className="text-base font-bold text-slate-900">
                          MS Agent is Ready for Your Voice or Text Command
                        </h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Ask any question, send WhatsApp messages, draft emails, or search live information in <strong>English</strong>, <strong>বাংলা (Bengali / Banglish)</strong>, or <strong>हिन्दी (Hindi)</strong>.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                        <button
                          onClick={startVoiceRecording}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl shadow-xs inline-flex items-center gap-1.5"
                        >
                          <Mic className="w-3.5 h-3.5" />
                          <span>Start Speaking</span>
                        </button>
                        <button
                          onClick={() => setActiveTab("whatsapp")}
                          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs inline-flex items-center gap-1.5"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>Link WhatsApp</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.role === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1 text-xs text-slate-400">
                        <span className="font-medium text-slate-600">
                          {msg.role === "user" ? "You" : "MS Agent"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{msg.timestamp}</span>
                        {msg.isVoice && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-700 font-medium">Voice</span>
                          </>
                        )}
                      </div>

                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-3.5 text-sm leading-relaxed shadow-xs ${
                          msg.role === "user"
                            ? "bg-slate-900 text-white"
                            : "bg-white border border-slate-200/90 text-slate-900"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.text}</p>

                        {/* Executed Automatic Actions Summary inside Message */}
                        {msg.executedActions && msg.executedActions.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-2">
                            <div className="text-xs font-semibold text-emerald-700">
                              Automatically Executed ({msg.executedActions.length})
                            </div>
                            {msg.executedActions.map((act) => {
                              const cleanPhone = String(
                                act.args.phoneNumber || directWaPhone
                              ).replace(/[^0-9]/g, "");
                              const waDirectUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                                String(act.args.replyMessage || "")
                              )}`;

                              return (
                                <div
                                  key={act.id}
                                  className="text-xs text-slate-700 flex flex-wrap items-center justify-between gap-3 py-1"
                                >
                                  <span>
                                    {act.toolName === "draft_email" &&
                                      `Auto-Dispatched Email to ${act.args.to}: "${act.args.subject}"`}
                                    {act.toolName === "reply_whatsapp" &&
                                      `Auto-Sent WhatsApp to ${act.args.contactName}: "${act.args.replyMessage}"`}
                                    {act.toolName === "create_systematic_task" &&
                                      `Auto-Logged Task: "${act.args.title}" (${act.args.dueTime})`}
                                  </span>
                                  <div className="flex items-center gap-3 shrink-0">
                                    {act.toolName === "reply_whatsapp" && (
                                      <a
                                        href={waDirectUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1"
                                      >
                                        <span>Launch WhatsApp App</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                    <button
                                      onClick={() => {
                                        if (act.toolName === "draft_email") setActiveTab("emails");
                                        if (act.toolName === "reply_whatsapp")
                                          setActiveTab("whatsapp");
                                        if (act.toolName === "create_systematic_task")
                                          setActiveTab("tasks");
                                      }}
                                      className="text-slate-700 font-medium underline"
                                    >
                                      View Log
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Search Grounding Sources */}
                        {msg.searchSources && msg.searchSources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-1.5">
                            <div className="text-xs font-medium text-slate-500">
                              Verified Web Sources:
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {msg.searchSources.map((src, i) => (
                                <a
                                  key={i}
                                  href={src.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1"
                                >
                                  <span className="truncate max-w-[220px]">{src.title}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Voice Playback Button for Assistant Messages */}
                        {msg.role === "assistant" && (
                          <div className="mt-2.5 flex items-center gap-3">
                            <button
                              onClick={() =>
                                playingMessageId === msg.id
                                  ? stopAudioPlayback()
                                  : speakResponse(msg.text, msg.id, msg.audioBase64)
                              }
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                            >
                              {playingMessageId === msg.id ? (
                                <>
                                  <Square className="w-3 h-3 fill-current text-emerald-700" />
                                  <span>Stop Voice Playback</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3 h-3" />
                                  <span>Replay Voice Answer</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isProcessing && (
                    <div className="flex items-center gap-3 text-xs text-slate-600 py-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                      <span>{statusMessage || "Processing your request..."}</span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Bottom Input & Voice Bar */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendCommandToAgent(inputText, false);
                  }}
                  className="p-4 border-t border-slate-200 bg-white flex items-center gap-2.5"
                >
                  <button
                    type="button"
                    onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                    disabled={isProcessing}
                    className={`p-3 rounded-xl transition-all shrink-0 ${
                      isRecording
                        ? "bg-red-600 text-white ring-4 ring-red-100"
                        : "bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200"
                    }`}
                    title={
                      isRecording
                        ? "Stop Recording"
                        : "Speak in English, Bengali, or Hindi"
                    }
                  >
                    {isRecording ? (
                      <Square className="w-4 h-4 fill-current" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>

                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={
                      isRecording
                        ? "Listening (English / বাংলা / हिन्दी)... Auto-sends when you pause"
                        : "Ask anything or command in English, বাংলা, or हिन्दी..."
                    }
                    disabled={isRecording || isProcessing}
                    className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-emerald-600"
                  />

                  <button
                    type="submit"
                    disabled={!inputText.trim() || isProcessing || isRecording}
                    className="px-5 py-2.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-500 shadow-xs transition-all flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40"
                  >
                    <span>Send</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </section>

              {/* Right 5 Cols: Direct WhatsApp Live Link Card, Automated Emails, and Tasks */}
              <section className="xl:col-span-5 space-y-6">
                {/* Direct WhatsApp Live Bridge Card */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        02. Direct WhatsApp Live Link & Auto-Reply
                      </h3>
                      <p className="text-xs text-slate-500">
                        {waStatus.state === "connected" && waStatus.connectedUser
                          ? `Connected to ${waStatus.connectedUser.phone} — Answering all incoming messages`
                          : "Link your WhatsApp for real-time AI answers"}
                      </p>
                    </div>
                    <button
                      onClick={() => setActiveTab("whatsapp")}
                      className="text-xs font-semibold text-emerald-700 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <span>
                        {waStatus.state === "connected" ? "Live Console" : "Link WhatsApp"}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Quick QR / Link Banner if not connected yet */}
                  {waStatus.state !== "connected" && (
                    <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 to-emerald-950 text-white flex items-center justify-between gap-3">
                      <div className="text-xs space-y-0.5">
                        <div className="font-semibold">
                          Connect Your Personal WhatsApp Account
                        </div>
                        <div className="text-slate-300">
                          Scan QR, enter 8-Digit Code, or enable 24/7 Vercel Webhook.
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setActiveTab("whatsapp");
                          if (waStatus.state === "disconnected") {
                            handleConnectRealWhatsApp(false);
                          }
                        }}
                        className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg whitespace-nowrap shrink-0"
                      >
                        Connect Now
                      </button>
                    </div>
                  )}

                  {/* Quick Incoming WhatsApp Auto-Answer Trigger */}
                  <form
                    onSubmit={handleSimulateIncomingWhatsApp}
                    className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5"
                  >
                    <div className="text-xs font-semibold text-slate-800">
                      Test Instant WhatsApp AI Answer & Direct Send (EN / বাংলা / हिन्दी)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={quickWaContact}
                        onChange={(e) => setQuickWaContact(e.target.value)}
                        placeholder="Sender Name (e.g. Rahul / तनवीर)"
                        className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-600"
                      />
                      <input
                        type="text"
                        value={quickWaPhone}
                        onChange={(e) => setQuickWaPhone(e.target.value)}
                        placeholder="Phone (+880... / +91...)"
                        className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:border-emerald-600"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={quickWaIncoming}
                        onChange={(e) => setQuickWaIncoming(e.target.value)}
                        placeholder="Type any question or message to test AI answer..."
                        className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-600"
                      />
                      <button
                        type="submit"
                        disabled={!quickWaIncoming.trim() || isAutoReplyingWa}
                        className="px-3.5 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-500 whitespace-nowrap disabled:opacity-50"
                      >
                        {isAutoReplyingWa ? "Answering..." : "AI Answer"}
                      </button>
                    </div>
                  </form>

                  <div className="divide-y divide-slate-100">
                    {whatsapps.slice(0, 2).map((wa) => {
                      const cleanPhone = wa.phoneNumber.replace(/[^0-9]/g, "");
                      return (
                        <div key={wa.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span className="font-semibold text-slate-900">
                              {wa.contactName} {wa.phoneNumber ? `(${wa.phoneNumber})` : ""}
                            </span>
                            <span className="font-mono tabular-nums">{wa.timestamp}</span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-1">
                            Incoming: "{wa.incomingMessage}"
                          </p>
                          <p className="text-xs text-slate-900 bg-emerald-50/70 p-2.5 rounded-lg border border-emerald-200/70">
                            AI Answer: "{wa.aiReply}"
                          </p>
                          <div className="flex items-center justify-between pt-1 text-xs">
                            <span className="text-emerald-700 font-semibold">
                              {wa.isLiveDeviceMessage
                                ? "Sent via Linked WhatsApp"
                                : wa.status}
                            </span>
                            <a
                              href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                                wa.aiReply
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-slate-900 hover:underline inline-flex items-center gap-1"
                            >
                              <span>Open in WhatsApp</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Automated Email Queue Preview */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">
                      03. Automated Email Dispatch Log
                    </h3>
                    <button
                      onClick={() => setActiveTab("emails")}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                    >
                      <span>View All ({emails.length})</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {emails.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">
                      No emails dispatched yet. Ask by voice or text to compose and send emails.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {emails.slice(0, 2).map((em) => (
                        <div key={em.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span className="font-medium text-slate-800 truncate">{em.to}</span>
                            <span className="font-mono tabular-nums">{em.timestamp}</span>
                          </div>
                          <div className="text-sm font-medium text-slate-900 truncate">
                            {em.subject}
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-slate-500">
                              {em.status} · Priority: {em.priority}
                            </span>
                            <button
                              onClick={() => handleOpenMailto(em)}
                              className="text-xs font-semibold text-emerald-700 hover:underline"
                            >
                              Open Mail Client
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active Systematic Tasks Preview */}
                <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">
                      04. Systematic Priority Notes
                    </h3>
                    <button
                      onClick={() => setActiveTab("tasks")}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                    >
                      <span>Manage ({tasks.length})</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {tasks.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">
                      No tasks logged yet. Ask MS Agent to schedule a note or reminder.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {tasks.slice(0, 3).map((tsk) => (
                        <div
                          key={tsk.id}
                          className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3"
                        >
                          <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                            <input
                              type="checkbox"
                              checked={tsk.completed}
                              onChange={() => toggleTaskCompletion(tsk.id)}
                              className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-0"
                            />
                            <div>
                              <div
                                className={`font-medium ${
                                  tsk.completed ? "line-through text-slate-400" : "text-slate-900"
                                }`}
                              >
                                {tsk.title}
                              </div>
                              <div className="text-slate-400 mt-0.5">
                                {tsk.category} ·{" "}
                                <span className="font-mono tabular-nums">{tsk.dueTime}</span>
                              </div>
                            </div>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* TAB 2: AUTOMATED EMAIL DESK */}
          {activeTab === "emails" && (
            <section className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    03. Automated Email Dispatch Desk
                  </h2>
                  <p className="text-xs text-slate-500">
                    Say by voice in English, Bengali, or Hindi: "Send an email to rahim@company.com about tomorrow's 11 AM project review" — AI automatically composes and dispatches it.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start">
                  {(
                    ["all", "Dispatched", "Drafted by AI", "Incoming Needs Reply"] as const
                  ).map((st) => (
                    <button
                      key={st}
                      onClick={() => setEmailFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        emailFilter === st
                          ? "bg-white text-slate-900 shadow-xs font-semibold"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {st === "all" ? "All Emails" : st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {filteredEmails.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <p className="text-sm text-slate-500">No emails in this view yet.</p>
                  </div>
                ) : (
                  filteredEmails.map((email) => (
                    <div key={email.id} className="py-5 first:pt-0 last:pb-0 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">
                            {email.subject}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <span>To: {email.to}</span>
                            <span aria-hidden="true">·</span>
                            <span>Status: {email.status}</span>
                            <span aria-hidden="true">·</span>
                            <span>Priority: {email.priority}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{email.timestamp}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() =>
                              speakResponse(`${email.subject}. ${email.body}`, email.id)
                            }
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                          >
                            Read Aloud
                          </button>
                          {email.status !== "Dispatched" && (
                            <button
                              onClick={() => handleDispatchEmail(email)}
                              className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 whitespace-nowrap"
                            >
                              Mark Dispatched
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenMailto(email)}
                            className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
                          >
                            Open in Mail App
                          </button>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {email.body}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* TAB 3: DIRECT WHATSAPP DEVICE LINK & AUTO-REPLY HUB */}
          {activeTab === "whatsapp" && (
            <section className="bg-white border border-slate-200/90 rounded-2xl shadow-xs p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    02. Direct WhatsApp Device Link & 24/7 Autonomous AI Auto-Reply
                  </h2>
                  <p className="text-xs text-slate-500">
                    Link your WhatsApp using QR Code or 8-Digit Pairing Code, or configure the 24/7 Vercel Cloud Webhook below. MS Agent reads every incoming message and replies with a real, direct answer in the sender's language.
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start">
                  {(
                    ["all", "Auto-Replied", "Ready to Send", "Pending AI Answer"] as const
                  ).map((st) => (
                    <button
                      key={st}
                      onClick={() => setWaFilter(st)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        waFilter === st
                          ? "bg-white text-slate-900 shadow-xs font-semibold"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {st === "all" ? "All Chats" : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* REAL WHATSAPP MULTI-DEVICE LINK PANEL (QR Code + Pairing Code) */}
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <h3 className="text-sm font-bold text-slate-900">
                        Live WhatsApp Multi-Device Connection
                      </h3>
                      <p className="text-xs text-slate-500">
                        Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
                      </p>
                    </div>
                    <span
                      className={`text-xs font-mono tabular-nums font-bold ${
                        waStatus.state === "connected"
                          ? "text-emerald-700"
                          : waStatus.state === "qr_ready"
                          ? "text-amber-700"
                          : "text-slate-500"
                      }`}
                    >
                      STATUS: {waStatus.state.toUpperCase()}
                    </span>
                  </div>

                  {waStatus.state === "connected" && waStatus.connectedUser ? (
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-bold text-emerald-950">
                            Connected: {waStatus.connectedUser.name}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-emerald-800">
                            WhatsApp Account: {waStatus.connectedUser.phone}
                          </div>
                        </div>
                        <button
                          onClick={handleDisconnectRealWhatsApp}
                          className="px-3 py-1.5 bg-white text-red-700 border border-red-200 text-xs font-semibold rounded-lg hover:bg-red-50 inline-flex items-center gap-1.5"
                        >
                          <Power className="w-3.5 h-3.5" />
                          <span>Unlink Device</span>
                        </button>
                      </div>

                      <div className="pt-2 border-t border-emerald-200/70 flex flex-wrap items-center gap-6 text-xs text-emerald-950">
                        <label className="flex items-center gap-2 cursor-pointer font-semibold">
                          <input
                            type="checkbox"
                            checked={waStatus.autoReplyEnabled}
                            onChange={(e) =>
                              handleToggleWaSettings(
                                e.target.checked,
                                waStatus.replyToSelfMessages
                              )
                            }
                            className="rounded border-emerald-400 text-emerald-700 focus:ring-0"
                          />
                          <span>Automatically Answer All Incoming WhatsApp Messages</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={waStatus.replyToSelfMessages}
                            onChange={(e) =>
                              handleToggleWaSettings(
                                waStatus.autoReplyEnabled,
                                e.target.checked
                              )
                            }
                            className="rounded border-emerald-400 text-emerald-700 focus:ring-0"
                          />
                          <span>Also Auto-Reply to Self-Test Messages</span>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => handleConnectRealWhatsApp(false)}
                          disabled={isConnectingWa}
                          className="px-4 py-2.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-500 shadow-xs transition-all inline-flex items-center gap-2 disabled:opacity-50"
                        >
                          <QrCode className="w-4 h-4" />
                          <span>
                            {isConnectingWa
                              ? "Generating Live QR..."
                              : waStatus.qrDataUrl
                              ? "Refresh QR Code"
                              : "Generate WhatsApp QR Code"}
                          </span>
                        </button>

                        {waStatus.qrDataUrl && (
                          <button
                            onClick={() => handleConnectRealWhatsApp(true)}
                            disabled={isConnectingWa}
                            className="px-3.5 py-2.5 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-xl hover:bg-slate-100 transition-colors"
                          >
                            Reset Session
                          </button>
                        )}
                      </div>

                      {/* Option B: Link with Phone Number Pairing Code */}
                      <form
                        onSubmit={handleRequestPairingCode}
                        className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2"
                      >
                        <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Or Link Using Phone Number Pairing Code (No Camera Needed)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={pairingPhoneInput}
                            onChange={(e) => setPairingPhoneInput(e.target.value)}
                            placeholder="Enter country code + phone (e.g. +88017... or +9198...)"
                            className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono tabular-nums focus:outline-none focus:border-emerald-600"
                          />
                          <button
                            type="submit"
                            disabled={isRequestingPairCode}
                            className="px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 whitespace-nowrap disabled:opacity-50"
                          >
                            {isRequestingPairCode ? "Requesting..." : "Get 8-Digit Code"}
                          </button>
                        </div>
                        {waStatus.pairingCode && (
                          <div className="pt-2 flex items-center justify-between text-xs text-emerald-900 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200">
                            <span>Enter this code on your phone in WhatsApp Linked Devices:</span>
                            <span className="font-mono tabular-nums text-base font-bold tracking-wider">
                              {waStatus.pairingCode}
                            </span>
                          </div>
                        )}
                      </form>
                    </div>
                  )}
                </div>

                {/* Right 5 Cols: QR Code Display Box */}
                <div className="lg:col-span-5 flex flex-col items-center justify-center p-5 bg-white rounded-2xl border border-slate-200 min-h-[260px]">
                  {waStatus.state === "connected" && waStatus.connectedUser ? (
                    <div className="text-center space-y-2 p-4">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                        <Check className="w-6 h-6" />
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        Live WhatsApp Auto-Agent Active
                      </div>
                      <p className="text-xs text-slate-500 max-w-xs">
                        When anyone sends a message to {waStatus.connectedUser.phone}, MS Agent will automatically answer their question on WhatsApp in real time.
                      </p>
                    </div>
                  ) : waStatus.qrDataUrl ? (
                    <div className="text-center space-y-2.5">
                      <div className="p-3 bg-white rounded-xl border-2 border-slate-900 inline-block shadow-sm">
                        <img
                          src={waStatus.qrDataUrl}
                          alt="WhatsApp Link QR Code"
                          referrerPolicy="no-referrer"
                          className="w-56 h-56 mx-auto block"
                        />
                      </div>
                      <p className="text-xs font-semibold text-slate-900">
                        Scan with WhatsApp → Settings → Linked Devices
                      </p>
                      <p className="text-[11px] text-slate-500">
                        After scanning, wait 2–3 seconds while WhatsApp completes synchronization.
                      </p>
                    </div>
                  ) : waStatus.state === "connecting" || isConnectingWa ? (
                    <div className="text-center space-y-3 p-4">
                      <RefreshCw className="w-8 h-8 mx-auto text-emerald-600 animate-spin" />
                      <div className="text-xs font-semibold text-slate-800">
                        Connecting to WhatsApp Server...
                      </div>
                      <p className="text-[11px] text-slate-500 max-w-xs">
                        Generating fresh QR code or completing device handshake. Please wait a moment.
                      </p>
                    </div>
                  ) : (
                    <div className="text-center space-y-3 p-4 text-xs text-slate-500">
                      <QrCode className="w-10 h-10 mx-auto text-slate-400" />
                      <p>
                        Click <strong>"Generate WhatsApp QR Code"</strong> on the left to display your live QR code here.
                      </p>
                      {waStatus.lastError && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                          {waStatus.lastError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* VERCEL 24/7 ALWAYS-ON CLOUD WEBHOOK CONFIGURATION */}
              <form
                onSubmit={handleSaveMetaCloudConfig}
                className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950 text-white space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Vercel 24/7 Background Mode (Even When Browser Tab is Closed)
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Keep this tab open on Vercel for QR WebSocket auto-keepalive, OR connect Meta WhatsApp Cloud API Webhook (<code className="text-emerald-300">/api/whatsapp/webhook</code>) so Vercel replies 24/7 even when your PC/phone browser is closed.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-emerald-300 shrink-0">
                    {waStatus.cloudWebhookConfigured
                      ? "CLOUD WEBHOOK: ACTIVE"
                      : "VERIFY TOKEN: ms_agent_verify_token"}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                  <input
                    type="password"
                    value={metaAccessTokenInput}
                    onChange={(e) => setMetaAccessTokenInput(e.target.value)}
                    placeholder="Optional: WHATSAPP_ACCESS_TOKEN (Meta Cloud API)"
                    className="md:col-span-5 bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-400"
                  />
                  <input
                    type="text"
                    value={metaPhoneIdInput}
                    onChange={(e) => setMetaPhoneIdInput(e.target.value)}
                    placeholder="Optional: WHATSAPP_PHONE_NUMBER_ID"
                    className="md:col-span-5 bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-slate-400 focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    type="submit"
                    className="md:col-span-2 py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {metaSavedBanner ? "Saved!" : "Save Cloud Key"}
                  </button>
                </div>
              </form>

              {/* Instant Test / Direct Sender Bar */}
              <form
                onSubmit={handleSimulateIncomingWhatsApp}
                className="p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
              >
                <div className="md:col-span-3 space-y-1">
                  <label className="text-xs font-medium text-slate-600">Contact Name</label>
                  <input
                    type="text"
                    value={quickWaContact}
                    onChange={(e) => setQuickWaContact(e.target.value)}
                    placeholder="e.g. Tanvir / विक्रम / Sarah"
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div className="md:col-span-3 space-y-1">
                  <label className="text-xs font-medium text-slate-600">
                    WhatsApp Number
                  </label>
                  <input
                    type="text"
                    value={quickWaPhone}
                    onChange={(e) => setQuickWaPhone(e.target.value)}
                    placeholder="+8801711002244"
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono tabular-nums focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div className="md:col-span-4 space-y-1">
                  <label className="text-xs font-medium text-slate-600">
                    Incoming Message or Topic (EN / বাংলা / हिन्दी)
                  </label>
                  <input
                    type="text"
                    value={quickWaIncoming}
                    onChange={(e) => setQuickWaIncoming(e.target.value)}
                    placeholder="Type message to auto-generate AI answer & send..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    type="submit"
                    disabled={!quickWaIncoming.trim() || isAutoReplyingWa}
                    className="w-full py-2 px-3 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {isAutoReplyingWa ? "Sending..." : "Auto-Reply & Send"}
                  </button>
                </div>
              </form>

              <div className="divide-y divide-slate-200">
                {filteredWhatsApps.map((wa) => {
                  const cleanPhone = wa.phoneNumber.replace(/[^0-9]/g, "");
                  return (
                    <div key={wa.id} className="py-5 first:pt-0 last:pb-0 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">
                            {wa.contactName}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <span className="font-mono tabular-nums">{wa.phoneNumber}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {wa.isLiveDeviceMessage
                                ? "Live Linked Device Auto-Reply"
                                : wa.status}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{wa.timestamp}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => speakResponse(wa.aiReply, wa.id)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                          >
                            Listen Voice Reply
                          </button>
                          <a
                            href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                              wa.aiReply
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleSendWhatsApp(wa)}
                            className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 whitespace-nowrap inline-flex items-center gap-1.5"
                          >
                            <span>Send Direct on WhatsApp</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                        <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                          <div className="text-xs text-slate-400 mb-1">
                            Incoming WhatsApp Message / Context
                          </div>
                          <p className="text-sm text-slate-700">{wa.incomingMessage}</p>
                        </div>
                        <div className="p-3.5 rounded-lg bg-emerald-50/60 border border-emerald-200/80">
                          <div className="text-xs text-emerald-800 font-medium mb-1">
                            AI Automatic Reply (Same Language Matched)
                          </div>
                          <p className="text-sm text-slate-900">{wa.aiReply}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* TAB 4: LIVE GOOGLE SEARCH GROUNDING DESK */}
          {activeTab === "search" && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    04. Live Google Search & Research Intelligence
                  </h2>
                  <p className="text-xs text-slate-500">
                    Ask any question by voice or text in English, Bengali, or Hindi — verified answers and live web sources are retrieved automatically.
                  </p>
                </div>

                <button
                  onClick={() => setActiveTab("command")}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg self-start whitespace-nowrap"
                >
                  New Voice Search
                </button>
              </div>

              <div className="divide-y divide-slate-200">
                {searches.map((srch) => (
                  <div key={srch.id} className="py-5 first:pt-0 last:pb-0 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{srch.query}</h3>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono tabular-nums text-slate-400">
                          {srch.timestamp}
                        </span>
                        <button
                          onClick={() => speakResponse(srch.summary, srch.id)}
                          className="text-xs font-medium text-emerald-700 hover:underline"
                        >
                          Listen Summary
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {srch.summary}
                    </p>
                    {srch.sources && srch.sources.length > 0 && (
                      <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-500">
                        <span>Sources:</span>
                        {srch.sources.map((s, idx) => (
                          <a
                            key={idx}
                            href={s.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-900 font-medium hover:underline inline-flex items-center gap-1"
                          >
                            <span>{s.title}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TAB 5: SYSTEMATIC NOTES & TASK LEDGER */}
          {activeTab === "tasks" && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    05. Systematic Daily Notes & Task Ledger
                  </h2>
                  <p className="text-xs text-slate-500">
                    All your tasks, reminders, and notes are organized systematically via voice commands or quick entry.
                  </p>
                </div>

                <input
                  type="search"
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                  placeholder="Filter tasks or notes..."
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
                />
              </div>

              {/* Quick Add Systematic Note Form */}
              <form
                onSubmit={handleAddManualTask}
                className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 bg-slate-50 rounded-lg border border-slate-200"
              >
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Add a new task or note (English / বাংলা / हिन्दी)..."
                  className="md:col-span-6 bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-slate-900"
                />
                <select
                  value={newTaskCategory}
                  onChange={(e) => setNewTaskCategory(e.target.value)}
                  className="md:col-span-2 bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                >
                  <option value="Personal">Personal</option>
                  <option value="Email Follow-up">Email Follow-up</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Meeting">Meeting</option>
                  <option value="Research">Research</option>
                </select>
                <input
                  type="text"
                  value={newTaskDue}
                  onChange={(e) => setNewTaskDue(e.target.value)}
                  placeholder="Time (e.g. Today 6:00 PM)"
                  className="md:col-span-2 bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono tabular-nums focus:outline-none"
                />
                <button
                  type="submit"
                  className="md:col-span-2 bg-slate-900 text-white text-xs font-medium rounded-lg px-4 py-2 hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Note</span>
                </button>
              </form>

              {/* High-Density Task Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Status</th>
                      <th className="py-2.5 px-4 font-medium">Task / Systematic Note</th>
                      <th className="py-2.5 px-4 font-medium">Category</th>
                      <th className="py-2.5 px-4 font-medium text-right">Scheduled Time</th>
                      <th className="py-2.5 pl-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredTasks.map((task) => (
                      <tr key={task.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 pr-4 whitespace-nowrap">
                          <button
                            onClick={() => toggleTaskCompletion(task.id)}
                            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                              task.completed ? "text-emerald-700" : "text-amber-700"
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{task.completed ? "Completed" : "Active"}</span>
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div
                            className={`font-medium ${
                              task.completed ? "line-through text-slate-400" : "text-slate-900"
                            }`}
                          >
                            {task.title}
                          </div>
                          {task.notes && (
                            <div className="text-xs text-slate-500 mt-0.5">{task.notes}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {task.category}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-700 text-right whitespace-nowrap">
                          {task.dueTime}
                        </td>
                        <td className="py-3 pl-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="text-xs text-slate-400 hover:text-red-600 p-1"
                            title="Delete task"
                          >
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
