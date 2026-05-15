const { createServer } = require("http");
const { Server } = require("socket.io");

const TOPICS = [
  "What is your favourite food and why?",
  "What is your dream job?",
  "What is the best trip you have ever taken?",
  "What is your favourite movie or TV show?",
  "If you had a superpower, what would you choose?",
  "What are your plans for this weekend?",
  "What hobby do you enjoy the most?",
  "If you were famous for one day, what would you do?",
  "What is your favourite season and why?",
  "How has technology changed your life?",
  "What is something new you learned recently?",
  "What kind of music do you like and why?",
  "If you could live anywhere, where would it be?",
  "What is a goal you are working towards?",
  "Describe your perfect day.",
];

function getRandomTopic() {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

// waitingQueue: array of { id, level, country }
let waitingQueue = [];
const activePairs = {};

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

// Find best match — same level preferred, same country bonus
function findMatch(socket, level, country) {
  if (waitingQueue.length === 0) return null;

  // Priority 1: same level + same country
  let idx = waitingQueue.findIndex(u => u.level === level && u.country === country);
  if (idx !== -1) return idx;

  // Priority 2: same level, any country
  idx = waitingQueue.findIndex(u => u.level === level);
  if (idx !== -1) return idx;

  // Priority 3: any user
  return 0;
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("find-partner", ({ level = "any", country = "any" } = {}) => {
    const idx = findMatch(socket, level, country);

    if (idx !== -1) {
      const partner = waitingQueue.splice(idx, 1)[0];
      const partnerSocket = io.sockets.sockets.get(partner.id);

      if (!partnerSocket) {
        // Partner disconnected, add self to queue
        waitingQueue.push({ id: socket.id, level, country });
        socket.emit("waiting");
        return;
      }

      activePairs[socket.id] = partner.id;
      activePairs[partner.id] = socket.id;

      const topic = getRandomTopic();
      socket.emit("partner-found", { initiator: true, topic, partnerLevel: partner.level, partnerCountry: partner.country });
      partnerSocket.emit("partner-found", { initiator: false, topic, partnerLevel: level, partnerCountry: country });

      console.log(`Paired: ${socket.id}(${level}/${country}) <-> ${partner.id}(${partner.level}/${partner.country})`);
    } else {
      waitingQueue.push({ id: socket.id, level, country });
      socket.emit("waiting");
      console.log(`Waiting: ${socket.id} (${level}/${country})`);
    }
  });

  socket.on("signal", (data) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) io.to(partnerId).emit("signal", data);
  });

  socket.on("chat-message", (message) => {
    console.log("chat from:", socket.id, "msg:", message);
    const partnerId = activePairs[socket.id];
    if (partnerId) io.to(partnerId).emit("chat-message", { text: message });
  });

  // Reaction event
  socket.on("reaction", (emoji) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) io.to(partnerId).emit("reaction", emoji);
  });

  socket.on("leave", () => {
    waitingQueue = waitingQueue.filter((u) => u.id !== socket.id);
    const partnerId = activePairs[socket.id];
    if (partnerId) { io.to(partnerId).emit("partner-left"); delete activePairs[partnerId]; }
    delete activePairs[socket.id];
  });

  socket.on("skip", () => {
    const partnerId = activePairs[socket.id];
    if (partnerId) { io.to(partnerId).emit("partner-left"); delete activePairs[partnerId]; }
    delete activePairs[socket.id];
    socket.emit("waiting");
  });

  socket.on("disconnect", () => {
    waitingQueue = waitingQueue.filter((u) => u.id !== socket.id);
    const partnerId = activePairs[socket.id];
    if (partnerId) { io.to(partnerId).emit("partner-left"); delete activePairs[partnerId]; }
    delete activePairs[socket.id];
    console.log("Disconnected:", socket.id);
  });
});

httpServer.listen(process.env.PORT || 3001, () =>
  console.log(`Socket.io server running on port ${process.env.PORT || 3001}`)
);