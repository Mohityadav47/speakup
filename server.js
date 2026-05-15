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
];

function getRandomTopic() {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

let waitingQueue = [];
const activePairs = {};

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("find-partner", () => {
    if (waitingQueue.length > 0) {
      const partnerId = waitingQueue.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (!partnerSocket) { waitingQueue.push(socket.id); socket.emit("waiting"); return; }
      activePairs[socket.id] = partnerId;
      activePairs[partnerId] = socket.id;
      const topic = getRandomTopic();
      socket.emit("partner-found", { initiator: true, topic });
      partnerSocket.emit("partner-found", { initiator: false, topic });
      console.log(`Paired: ${socket.id} <-> ${partnerId}`);
    } else {
      waitingQueue.push(socket.id);
      socket.emit("waiting");
    }
  });

  socket.on("signal", (data) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) io.to(partnerId).emit("signal", data);
  });

  socket.on("chat-message", (message) => {
    console.log("chat from:", socket.id, "msg:", message);
    const partnerId = activePairs[socket.id];
    console.log("sending to partner:", partnerId);
    if (partnerId) io.to(partnerId).emit("chat-message", { text: message });
  });

  socket.on("leave", () => {
    waitingQueue = waitingQueue.filter((id) => id !== socket.id);
    const partnerId = activePairs[socket.id];
    if (partnerId) { io.to(partnerId).emit("partner-left"); delete activePairs[partnerId]; }
    delete activePairs[socket.id];
  });

  socket.on("skip", () => {
    const partnerId = activePairs[socket.id];
    if (partnerId) { io.to(partnerId).emit("partner-left"); delete activePairs[partnerId]; }
    delete activePairs[socket.id];
    waitingQueue.push(socket.id);
    socket.emit("waiting");
  });

  socket.on("disconnect", () => {
    waitingQueue = waitingQueue.filter((id) => id !== socket.id);
    const partnerId = activePairs[socket.id];
    if (partnerId) { io.to(partnerId).emit("partner-left"); delete activePairs[partnerId]; }
    delete activePairs[socket.id];
    console.log("Disconnected:", socket.id);
  });
});

httpServer.listen(3001, () => console.log("Socket.io server running on port 3001"));