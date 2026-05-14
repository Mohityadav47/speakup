"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

type Status = "idle" | "requesting_mic" | "waiting" | "connected" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [topic, setTopic] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [partnerLeft, setPartnerLeft] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setTimer(0);
    timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimer(0);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const cleanupPeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    stopTimer();
  }, []);

  const createPeer = useCallback(
    (initiator: boolean, socket: Socket): RTCPeerConnection => {
      const peer = new RTCPeerConnection(ICE_SERVERS);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          peer.addTrack(track, localStreamRef.current!);
        });
      }

      peer.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play().catch(() => {});
        }
      };

      peer.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("signal", { type: "ice", candidate: e.candidate });
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setStatus("connected");
          startTimer();
        }
      };

      if (initiator) {
        peer.onnegotiationneeded = async () => {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.emit("signal", { type: "offer", sdp: peer.localDescription });
        };
      }

      return peer;
    },
    []
  );

  useEffect(() => {
    fetch("/api/socket");

    const socket = io("https://speakup-production-c093.up.railway.app", {
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("waiting", () => setStatus("waiting"));

    socket.on("partner-found", ({ initiator, topic }: { initiator: boolean; topic: string }) => {
      setTopic(topic);
      setPartnerLeft(false);
      const peer = createPeer(initiator, socket);
      peerRef.current = peer;
    });

    socket.on("signal", async (data: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const peer = peerRef.current;
      if (!peer) return;

      if (data.type === "offer" && data.sdp) {
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("signal", { type: "answer", sdp: peer.localDescription });
      } else if (data.type === "answer" && data.sdp) {
        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "ice" && data.candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });

    socket.on("partner-left", () => {
      cleanupPeer();
      setPartnerLeft(true);
      setStatus("idle");
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [createPeer, cleanupPeer]);

  const handleStart = async () => {
    setStatus("requesting_mic");
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setStatus("waiting");
      socketRef.current?.emit("find-partner");
    } catch {
      setErrorMsg("Microphone access denied. Please allow mic and try again.");
      setStatus("error");
    }
  };

  const handleSkip = () => {
    cleanupPeer();
    setPartnerLeft(false);
    socketRef.current?.emit("skip");
    setStatus("waiting");
  };

  const handleDisconnect = () => {
    cleanupPeer();
    socketRef.current?.emit("skip");
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setStatus("idle");
    setPartnerLeft(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted((m) => !m);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#0d0f14] flex flex-col items-center justify-between px-4 py-10"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 20% 50%, #0f2027 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1628 0%, transparent 50%)",
      }}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Header */}
      <header className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-4xl">🗣️</span>
          <span
            className="text-3xl font-bold"
            style={{
              fontFamily: "'Sora', sans-serif",
              background: "linear-gradient(135deg, #4ade80, #22d3ee)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            SpeakUp
          </span>
        </div>
        <p className="text-[#8892a4] text-sm">Practice English with real people, instantly</p>
      </header>

      {/* Card */}
      <main className="w-full max-w-md">
        <div className="bg-[#161b24] border border-white/10 rounded-3xl p-10 shadow-2xl min-h-[380px] flex items-center justify-center">

          {/* IDLE */}
          {status === "idle" && (
            <div className="flex flex-col items-center gap-4 text-center w-full">
              {partnerLeft && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-full text-sm">
                  Your partner has left the chat.
                </div>
              )}
              <div className="text-6xl">🌐</div>
              <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "'Sora', sans-serif" }}>
                Ready to speak?
              </h2>
              <p className="text-[#8892a4] text-sm max-w-xs leading-relaxed">
                Connect with a random person and practice English. No login needed.
              </p>
              <button
                onClick={handleStart}
                className="mt-2 px-8 py-3 rounded-full font-bold text-[#0d0f14] transition-all hover:-translate-y-1"
                style={{
                  background: "linear-gradient(135deg, #4ade80, #16a34a)",
                  boxShadow: "0 4px 20px #4ade8050",
                }}
              >
                Find a Partner
              </button>
            </div>
          )}

          {/* REQUESTING MIC */}
          {status === "requesting_mic" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="text-6xl animate-pulse">🎙️</div>
              <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "'Sora', sans-serif" }}>
                Allow Microphone
              </h2>
              <p className="text-[#8892a4] text-sm">Please allow mic access in your browser popup.</p>
            </div>
          )}

          {/* WAITING */}
          {status === "waiting" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 border-4 border-white/10 border-t-[#4ade80] rounded-full animate-spin" />
              <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "'Sora', sans-serif" }}>
                Finding a partner…
              </h2>
              <p className="text-[#8892a4] text-sm">Looking for someone to practice English with you</p>
              <button
                onClick={handleDisconnect}
                className="px-6 py-2 rounded-full text-[#8892a4] bg-[#1e2535] border border-white/10 hover:text-white transition-all text-sm"
              >
                Cancel
              </button>
            </div>
          )}

          {/* CONNECTED */}
          {status === "connected" && (
            <div className="flex flex-col items-center gap-4 text-center w-full">
              <div className="flex items-center gap-2 bg-green-400/10 border border-green-400/30 px-4 py-1.5 rounded-full">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-green-400 text-sm font-semibold">Connected</span>
              </div>

              <div
                className="text-5xl font-bold text-white tracking-widest"
                style={{ fontFamily: "'Sora', sans-serif" }}
              >
                {formatTime(timer)}
              </div>

              <div className="bg-[#1e2535] border border-white/10 rounded-2xl p-4 w-full text-left">
                <span className="block text-xs text-cyan-400 uppercase tracking-widest font-semibold mb-1">
                  Today's Topic 💬
                </span>
                <p className="text-white font-semibold leading-relaxed" style={{ fontFamily: "'Sora', sans-serif" }}>
                  {topic}
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap justify-center">
                <button
                  onClick={toggleMute}
                  className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border transition-all text-xl min-w-[70px] bg-[#1e2535] ${
                    isMuted ? "border-red-400/40 text-red-400" : "border-white/10 text-[#8892a4] hover:text-white"
                  }`}
                >
                  {isMuted ? "🔇" : "🎙️"}
                  <span className="text-xs">{isMuted ? "Unmute" : "Mute"}</span>
                </button>

                <button
                  onClick={handleSkip}
                  className="px-6 py-3 rounded-full font-bold text-[#0d0f14] transition-all hover:-translate-y-1"
                  style={{
                    background: "linear-gradient(135deg, #22d3ee, #0891b2)",
                    boxShadow: "0 4px 20px #22d3ee40",
                  }}
                >
                  ⏭ Next Partner
                </button>

                <button
                  onClick={handleDisconnect}
                  className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl border border-white/10 bg-[#1e2535] text-[#8892a4] hover:text-red-400 hover:border-red-400/40 transition-all text-xl min-w-[70px]"
                >
                  📵<span className="text-xs">Leave</span>
                </button>
              </div>

              <p className="text-xs text-[#8892a4] bg-white/5 rounded-lg px-3 py-2 w-full leading-relaxed">
                💡 Tip: Speak slowly and clearly. Don&apos;t worry about mistakes!
              </p>
            </div>
          )}

          {/* ERROR */}
          {status === "error" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="text-6xl">⚠️</div>
              <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "'Sora', sans-serif" }}>
                Oops!
              </h2>
              <p className="text-red-400 text-sm">{errorMsg}</p>
              <button
                onClick={() => setStatus("idle")}
                className="px-8 py-3 rounded-full font-bold text-[#0d0f14]"
                style={{ background: "linear-gradient(135deg, #4ade80, #16a34a)" }}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="mt-8 text-[#8892a4] text-xs text-center">
        No login required · Voice only · 100% free
      </footer>
    </div>
  );
}