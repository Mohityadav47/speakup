"use client";

import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = "https://speakup-production-c093.up.railway.app";


const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

type Status = "idle" | "waiting" | "connected" | "error";

interface ChatMsg {
  text: string;
  from: "me" | "partner";
  time: string;
}

interface Stats {
  totalSessions: number;
  totalSeconds: number;
  todaySessions: number;
  todaySeconds: number;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
  from: "me" | "partner";
}

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const COUNTRIES = [
  "Any", "India", "USA", "UK", "Australia", "Canada",
  "Germany", "France", "Japan", "Brazil", "Pakistan",
  "Bangladesh", "Nepal", "Sri Lanka", "Philippines",
];

const REACTIONS = ["👍", "😂", "❤️", "👏", "🔥", "😮", "😢", "🎉"];

function getNow() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function loadStats(): Stats {
  if (typeof window === "undefined") return { totalSessions: 0, totalSeconds: 0, todaySessions: 0, todaySeconds: 0 };
  try {
    const raw = localStorage.getItem("speakup_stats");
    if (!raw) return { totalSessions: 0, totalSeconds: 0, todaySessions: 0, todaySeconds: 0 };
    return JSON.parse(raw);
  } catch { return { totalSessions: 0, totalSeconds: 0, todaySessions: 0, todaySeconds: 0 }; }
}

function saveStats(stats: Stats) {
  if (typeof window === "undefined") return;
  localStorage.setItem("speakup_stats", JSON.stringify(stats));
}

function sendNotification(title: string, body: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!document.hidden) return;
  new Notification(title, { body, icon: "/favicon.ico" });
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [topic, setTopic] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [partnerLeft, setPartnerLeft] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [unread, setUnread] = useState(0);
  const [activeTab, setActiveTab] = useState<"call" | "stats">("call");
  const [notifPermission, setNotifPermission] = useState<string>("default");
  const [showReactions, setShowReactions] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const reactionIdRef = useRef(0);

  // Filters
  const [selectedLevel, setSelectedLevel] = useState("Beginner");
  const [selectedCountry, setSelectedCountry] = useState("Any");

  // Stats
  const [stats, setStats] = useState<Stats>(loadStats());

  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const showChatRef = useRef(false);
  const sessionStartRef = useRef<number>(0);

  useEffect(() => { showChatRef.current = showChat; }, [showChat]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const requestNotifPermission = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  };

  // Add floating reaction animation
  const addFloatingReaction = (emoji: string, from: "me" | "partner") => {
    const id = reactionIdRef.current++;
    const x = 20 + Math.random() * 60; // random x position %
    setFloatingReactions((prev) => [...prev, { id, emoji, x, from }]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2500);
  };

  const startTimer = () => {
    setTimer(0);
    sessionStartRef.current = Date.now();
    timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const saveSession = (seconds: number) => {
    if (seconds < 5) return;
    const newStats = loadStats();
    newStats.totalSessions += 1;
    newStats.totalSeconds += seconds;
    newStats.todaySessions += 1;
    newStats.todaySeconds += seconds;
    saveStats(newStats);
    setStats(newStats);
  };

  const cleanupPeer = () => {
    const elapsed = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    if (elapsed > 5) saveSession(elapsed);
    peerRef.current?.close(); peerRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    stopTimer();
    setTimer(0);
    setFloatingReactions([]);
    setShowReactions(false);
  };

  const createPeer = (initiator: boolean, socket: Socket) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);
    localStreamRef.current?.getTracks().forEach((t) => peer.addTrack(t, localStreamRef.current!));
    peer.ontrack = (e) => {
      if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = e.streams[0]; remoteAudioRef.current.play().catch(() => {}); }
    };
    peer.onicecandidate = (e) => { if (e.candidate) socket.emit("signal", { type: "ice", candidate: e.candidate }); };
    peer.onconnectionstatechange = () => { if (peer.connectionState === "connected") { setStatus("connected"); startTimer(); } };
    if (initiator) {
      peer.onnegotiationneeded = async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit("signal", { type: "offer", sdp: peer.localDescription });
      };
    }
    return peer;
  };

  const setupSocketListeners = (socket: Socket) => {
    socket.on("waiting", () => setStatus("waiting"));

    socket.on("partner-found", ({ initiator, topic }: { initiator: boolean; topic: string }) => {
      setTopic(topic); setPartnerLeft(false); setMessages([]); setShowChat(false); setUnread(0);
      showChatRef.current = false; setFloatingReactions([]); setShowReactions(false);
      peerRef.current = createPeer(initiator, socket);
      sendNotification("SpeakUp 🎙️", "Partner mil gaya! Ab baat karo.");
    });

    socket.on("signal", async (data: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const peer = peerRef.current; if (!peer) return;
      try {
        if (data.type === "offer" && data.sdp) {
          if (peer.signalingState !== "stable") return;
          await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const ans = await peer.createAnswer(); await peer.setLocalDescription(ans);
          socket.emit("signal", { type: "answer", sdp: peer.localDescription });
        } else if (data.type === "answer" && data.sdp) {
          if (peer.signalingState !== "have-local-offer") return;
          await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === "ice" && data.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (e) { console.error("Signal error:", e); }
    });

    socket.on("chat-message", ({ text }: { text: string }) => {
      setMessages((prev) => [...prev, { text, from: "partner", time: getNow() }]);
      if (!showChatRef.current) setUnread((u) => u + 1);
      sendNotification("SpeakUp 💬", `New message: ${text}`);
    });

    // Partner ka reaction receive karo
    socket.on("reaction", (emoji: string) => {
      addFloatingReaction(emoji, "partner");
      sendNotification("SpeakUp " + emoji, `Partner ne react kiya: ${emoji}`);
    });

    socket.on("partner-left", () => {
      cleanupPeer(); setPartnerLeft(true); setStatus("idle");
      sendNotification("SpeakUp 👋", "Partner ne chat chhod di.");
    });
  };

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => console.log("Socket connected:", socket.id));
    setupSocketListeners(socket);
    return () => { socket.disconnect(); cleanupPeer(); localStreamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const handleStart = async () => {
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setStatus("waiting");
      socketRef.current?.emit("find-partner", {
        level: selectedLevel,
        country: selectedCountry === "Any" ? "any" : selectedCountry,
      });
    } catch {
      setErrorMsg("Microphone access denied. Please allow mic and try again.");
      setStatus("error");
    }
  };

  const handleSkip = () => {
    cleanupPeer(); setPartnerLeft(false); setMessages([]); setShowChat(false); setUnread(0);
    socketRef.current?.emit("skip");
    setStatus("waiting");
    setTimeout(() => {
      socketRef.current?.emit("find-partner", {
        level: selectedLevel,
        country: selectedCountry === "Any" ? "any" : selectedCountry,
      });
    }, 100);
  };

  const handleDisconnect = () => {
    cleanupPeer();
    socketRef.current?.emit("leave");
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setStatus("idle"); setPartnerLeft(false); setMessages([]); setShowChat(false); setUnread(0);
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((m) => !m);
  };

  const sendMessage = () => {
    const text = chatInput.trim(); if (!text) return;
    socketRef.current?.emit("chat-message", text);
    setMessages((prev) => [...prev, { text, from: "me", time: getNow() }]);
    setChatInput("");
  };

  const sendReaction = (emoji: string) => {
    socketRef.current?.emit("reaction", emoji);
    addFloatingReaction(emoji, "me");
    setShowReactions(false);
  };

  return (
    <div
      className="min-h-screen bg-[#0d0f14] flex flex-col items-center justify-between px-4 py-8"
      style={{ backgroundImage: "radial-gradient(ellipse at 20% 50%, #0f2027 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1628 0%, transparent 50%)" }}
    >
      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-120px) scale(1.5); opacity: 0; }
        }
        .float-reaction {
          animation: floatUp 2.5s ease-out forwards;
          position: absolute;
          pointer-events: none;
          font-size: 2rem;
          z-index: 50;
        }
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        .pop-in { animation: popIn 0.2s ease forwards; }
      `}</style>

      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Header */}
      <header className="text-center mb-6">
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-4xl">🗣️</span>
          <span className="text-3xl font-bold" style={{ fontFamily: "'Sora', sans-serif", background: "linear-gradient(135deg, #4ade80, #22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            SpeakUp
          </span>
        </div>
        <p className="text-[#8892a4] text-sm">Practice English with real people, instantly</p>

        {notifPermission !== "granted" && notifPermission !== "denied" && (
          <button onClick={requestNotifPermission} className="mt-3 flex items-center gap-2 mx-auto px-4 py-2 rounded-full text-xs font-medium border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-all">
            🔔 Enable Notifications
          </button>
        )}
        {notifPermission === "granted" && (
          <div className="mt-2 text-xs text-green-400">✅ Notifications enabled</div>
        )}

        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setActiveTab("call")} className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === "call" ? "bg-cyan-600 text-white" : "bg-[#1e2535] text-[#8892a4] hover:text-white"}`}>
            🎙️ Practice
          </button>
          <button onClick={() => setActiveTab("stats")} className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${activeTab === "stats" ? "bg-cyan-600 text-white" : "bg-[#1e2535] text-[#8892a4] hover:text-white"}`}>
            📊 My Stats
          </button>
        </div>
      </header>

      <main className="w-full max-w-4xl">

        {/* STATS TAB */}
        {activeTab === "stats" && (
          <div className="w-full max-w-md mx-auto bg-[#161b24] border border-white/10 rounded-3xl p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-6 text-center">📊 Practice Stats</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              {[
                { label: "Total Sessions", value: stats.totalSessions, icon: "🎯" },
                { label: "Total Practice", value: formatDuration(stats.totalSeconds), icon: "⏱️" },
                { label: "Today Sessions", value: stats.todaySessions, icon: "📅" },
                { label: "Today Practice", value: formatDuration(stats.todaySeconds), icon: "🔥" },
              ].map((stat, i) => (
                <div key={i} className="bg-[#1e2535] border border-white/10 rounded-2xl p-4 text-center">
                  <div className="text-2xl mb-1">{stat.icon}</div>
                  <div className="text-xl font-bold text-white">{stat.value}</div>
                  <div className="text-xs text-[#8892a4] mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
            {stats.totalSessions === 0 && <p className="text-center text-[#8892a4] text-sm">No sessions yet. Start practicing! 🚀</p>}
            <button
              onClick={() => { const e = { totalSessions: 0, totalSeconds: 0, todaySessions: 0, todaySeconds: 0 }; saveStats(e); setStats(e); }}
              className="w-full mt-2 py-2 rounded-xl text-xs text-[#8892a4] border border-white/10 hover:text-red-400 hover:border-red-400/30 transition-all"
            >Reset Stats</button>
          </div>
        )}

        {/* CALL TAB */}
        {activeTab === "call" && (
          <div className={`flex gap-4 ${status === "connected" && showChat ? "flex-col md:flex-row items-start justify-center" : "justify-center"}`}>

            {/* Main card */}
            <div className={`bg-[#161b24] border border-white/10 rounded-3xl p-8 shadow-2xl min-h-[400px] flex items-center justify-center ${status === "connected" && showChat ? "flex-1 max-w-md" : "w-full max-w-md"}`}>

              {/* IDLE */}
              {status === "idle" && (
                <div className="flex flex-col items-center gap-5 text-center w-full">
                  {partnerLeft && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-full text-sm">Your partner has left the chat.</div>
                  )}
                  <div className="text-6xl">🌐</div>
                  <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "'Sora', sans-serif" }}>Ready to speak?</h2>
                  <div className="w-full">
                    <label className="text-xs text-[#8892a4] uppercase tracking-widest font-semibold mb-2 block">⭐ Your Level</label>
                    <div className="flex gap-2 justify-center flex-wrap">
                      {LEVELS.map((level) => (
                        <button key={level} onClick={() => setSelectedLevel(level)} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all ${selectedLevel === level ? "bg-cyan-600 text-white" : "bg-[#1e2535] text-[#8892a4] border border-white/10 hover:text-white"}`}>
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-full">
                    <label className="text-xs text-[#8892a4] uppercase tracking-widest font-semibold mb-2 block">🌍 Your Country</label>
                    <select value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value)} className="w-full bg-[#1e2535] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-500/50 transition-colors">
                      {COUNTRIES.map((c) => <option key={c} value={c} style={{ background: "#1e2535" }}>{c === "Any" ? "🌍 Any Country" : c}</option>)}
                    </select>
                  </div>
                  <button onClick={handleStart} className="w-full py-3 rounded-full font-bold text-[#0d0f14] transition-all hover:-translate-y-1" style={{ background: "linear-gradient(135deg, #4ade80, #16a34a)", boxShadow: "0 4px 20px #4ade8050" }}>
                    Find a Partner
                  </button>
                  <p className="text-xs text-[#8892a4]">Level: <span className="text-cyan-400">{selectedLevel}</span> · Country: <span className="text-cyan-400">{selectedCountry}</span></p>
                </div>
              )}

              {/* WAITING */}
              {status === "waiting" && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="w-16 h-16 border-4 border-white/10 border-t-[#4ade80] rounded-full animate-spin" />
                  <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "'Sora', sans-serif" }}>Finding a partner…</h2>
                  <p className="text-[#8892a4] text-sm">
                    Looking for <span className="text-cyan-400">{selectedLevel}</span> level
                    {selectedCountry !== "Any" && <> from <span className="text-cyan-400">{selectedCountry}</span></>}
                  </p>
                  <button onClick={handleDisconnect} className="px-6 py-2 rounded-full text-[#8892a4] bg-[#1e2535] border border-white/10 hover:text-white transition-all text-sm">Cancel</button>
                </div>
              )}

              {/* CONNECTED */}
              {status === "connected" && (
                <div className="flex flex-col items-center gap-4 text-center w-full relative">

                  {/* Floating reactions */}
                  <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    {floatingReactions.map((r) => (
                      <div key={r.id} className="float-reaction" style={{ left: `${r.x}%`, bottom: "80px" }}>
                        {r.emoji}
                        {r.from === "partner" && <span className="text-xs absolute -top-3 left-0 text-[#8892a4]">👤</span>}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 bg-green-400/10 border border-green-400/30 px-4 py-1.5 rounded-full">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-green-400 text-sm font-semibold">Connected</span>
                  </div>

                  <div className="text-5xl font-bold text-white tracking-widest" style={{ fontFamily: "'Sora', sans-serif" }}>{fmt(timer)}</div>

                  <div className="bg-[#1e2535] border border-white/10 rounded-2xl p-4 w-full text-left">
                    <span className="block text-xs text-cyan-400 uppercase tracking-widest font-semibold mb-1">Today&apos;s Topic 💬</span>
                    <p className="text-white font-semibold leading-relaxed">{topic}</p>
                  </div>

                  {/* Reaction picker */}
                  {showReactions && (
                    <div className="pop-in flex flex-wrap gap-2 justify-center bg-[#1e2535] border border-white/10 rounded-2xl p-3 w-full">
                      {REACTIONS.map((emoji) => (
                        <button key={emoji} onClick={() => sendReaction(emoji)} className="text-2xl hover:scale-125 transition-transform active:scale-95 p-1">
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    <button onClick={toggleMute} className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border transition-all text-xl min-w-[70px] bg-[#1e2535] ${isMuted ? "border-red-400/40 text-red-400" : "border-white/10 text-[#8892a4] hover:text-white"}`}>
                      {isMuted ? "🔇" : "🎙️"}<span className="text-xs">{isMuted ? "Unmute" : "Mute"}</span>
                    </button>

                    {/* React button */}
                    <button
                      onClick={() => setShowReactions((s) => !s)}
                      className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border transition-all text-xl min-w-[70px] bg-[#1e2535] ${showReactions ? "border-yellow-400/40 text-yellow-400" : "border-white/10 text-[#8892a4] hover:text-white"}`}
                    >
                      😊<span className="text-xs">React</span>
                    </button>

                    <button
                      onClick={() => { setShowChat((s) => !s); setUnread(0); showChatRef.current = !showChatRef.current; }}
                      className="relative flex flex-col items-center gap-1 px-4 py-3 rounded-xl border transition-all text-xl min-w-[70px] bg-[#1e2535] border-white/10 text-[#8892a4] hover:text-white"
                    >
                      💬<span className="text-xs">Chat</span>
                      {unread > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-cyan-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center animate-bounce">{unread}</span>}
                    </button>

                    <button onClick={handleSkip} className="px-6 py-3 rounded-full font-bold text-[#0d0f14] transition-all hover:-translate-y-1" style={{ background: "linear-gradient(135deg, #22d3ee, #0891b2)", boxShadow: "0 4px 20px #22d3ee40" }}>
                      ⏭ Next
                    </button>

                    <button onClick={handleDisconnect} className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl border border-white/10 bg-[#1e2535] text-[#8892a4] hover:text-red-400 hover:border-red-400/40 transition-all text-xl min-w-[70px]">
                      📵<span className="text-xs">Leave</span>
                    </button>
                  </div>

                  <p className="text-xs text-[#8892a4] bg-white/5 rounded-lg px-3 py-2 w-full leading-relaxed">
                    💡 Tip: React karo 😊 button se partner ko encourage karo!
                  </p>
                </div>
              )}

              {/* ERROR */}
              {status === "error" && (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="text-6xl">⚠️</div>
                  <h2 className="text-2xl font-bold text-white">Oops!</h2>
                  <p className="text-red-400 text-sm">{errorMsg}</p>
                  <button onClick={() => setStatus("idle")} className="px-8 py-3 rounded-full font-bold text-[#0d0f14]" style={{ background: "linear-gradient(135deg, #4ade80, #16a34a)" }}>Try Again</button>
                </div>
              )}
            </div>

            {/* Chat Panel */}
            {status === "connected" && showChat && (
              <div className="w-full md:w-80 bg-[#161b24] border border-white/10 rounded-3xl flex flex-col overflow-hidden" style={{ height: 460 }}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                  <div className="flex items-center gap-2"><span>💬</span><span className="font-semibold text-white text-sm">Live Chat</span></div>
                  <button onClick={() => { setShowChat(false); showChatRef.current = false; }} className="text-[#8892a4] hover:text-white text-lg">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
                  {messages.length === 0 && <div className="text-center text-[#8892a4] text-xs mt-10 leading-relaxed">No messages yet.<br />Say hi! 👋</div>}
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex flex-col ${msg.from === "me" ? "items-end" : "items-start"}`}>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm max-w-[85%] leading-relaxed ${msg.from === "me" ? "bg-cyan-600 text-white rounded-br-sm" : "bg-[#1e2535] text-white rounded-bl-sm"}`}>
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-[#8892a4] mt-1 px-1">{msg.time}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="px-4 py-3 border-t border-white/10 flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type a message..."
                    maxLength={300}
                    className="flex-1 bg-[#1e2535] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#8892a4] outline-none focus:border-cyan-500/50 transition-colors"
                  />
                  <button onClick={sendMessage} disabled={!chatInput.trim()} className="w-10 h-10 rounded-xl flex items-center justify-center text-base transition-all disabled:opacity-30 flex-shrink-0" style={{ background: chatInput.trim() ? "linear-gradient(135deg, #22d3ee, #0891b2)" : "#1e2535" }}>➤</button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="mt-8 text-[#8892a4] text-xs text-center">
        No login required · Voice + Chat + Reactions · 100% free
      </footer>
    </div>
  );
}