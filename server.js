const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Waiting queue — users waiting for a partner
let waitingQueue = [];

// Active pairs — socketId -> partnerSocketId
let activePairs = {};

const TOPICS = [
  "Apna favourite food kya hai aur kyun?",
  "Aapka dream job kya hai?",
  "Aapne abhi tak ki best trip kahan ki?",
  "Aapka favourite movie/show kaunsa hai?",
  "Agar aapke paas superpower hoti toh kya chahte?",
  "Apne weekend ke plans batao.",
  "Aapko kaunsa hobby pasand hai?",
  "Agar aap ek din ke liye famous hote toh kya karte?",
  "Aapka favourite season kaunsa hai aur kyun?",
  "Technology ne life kaise change ki hai?",
];

function getRandomTopic() {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User wants to find a partner
  socket.on("find-partner", () => {
    // If someone already waiting, pair them
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);

      if (!partnerSocket) {
        // Partner disconnected while waiting, try again
        socket.emit("find-partner");
        return;
      }

      // Create pair
      activePairs[socket.id] = partnerId;
      activePairs[partnerId] = socket.id;

      const topic = getRandomTopic();

      // Notify both — caller initiates WebRTC
      socket.emit("partner-found", { initiator: true, topic });
      partnerSocket.emit("partner-found", { initiator: false, topic });

      console.log(`Paired: ${socket.id} <-> ${partnerId}`);
    } else {
      // Add to waiting queue
      waitingQueue.push(socket.id);
      socket.emit("waiting");
      console.log(`Waiting: ${socket.id}`);
    }
  });

  // WebRTC Signaling — forward offer/answer/ice to partner
  socket.on("signal", (data) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("signal", data);
    }
  });

  // User skips current partner
  socket.on("skip", () => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("partner-left");
      delete activePairs[partnerId];
    }
    delete activePairs[socket.id];

    // Put back in queue
    waitingQueue.push(socket.id);
    socket.emit("waiting");
  });

/////socket on chate k lie

  socket.on("chat-message", (message) => {
  const partnerId = activePairs[socket.id];
  if (partnerId) {
    io.to(partnerId).emit("chat-message", { text: message });
  }
});
/////////dsicnect ke liye update
socket.on("leave", () => {
  waitingQueue = waitingQueue.filter((id) => id !== socket.id);
  const partnerId = activePairs[socket.id];
  if (partnerId) {
    io.to(partnerId).emit("partner-left");
    delete activePairs[partnerId];
  }
  delete activePairs[socket.id];
});

  // User disconnects
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Remove from waiting queue
    waitingQueue = waitingQueue.filter((id) => id !== socket.id);

    // Notify partner
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("partner-left");
      delete activePairs[partnerId];
    }
    delete activePairs[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
