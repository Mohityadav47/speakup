import { Server, Socket } from "socket.io";
import { Server as HTTPServer } from "http";

const TOPICS: string[] = [
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
  "Describe your perfect day.",
  "What is something new you learned recently?",
  "What kind of music do you like and why?",
  "If you could live anywhere in the world, where would it be?",
  "What is a goal you are working towards right now?",
];

function getRandomTopic(): string {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

let io: Server | null = null;
let waitingQueue: string[] = [];
const activePairs: Record<string, string> = {};

export function initSocket(server: HTTPServer): Server {
  if (io) return io;

  io = new Server(server, {
    path: "/api/socket",
    cors: { origin: "*" },
  });

  io.on("connection", (socket: Socket) => {
    console.log("Connected:", socket.id);

    socket.on("find-partner", () => {
      if (waitingQueue.length > 0) {
        const partnerId = waitingQueue.shift()!;
        const partnerSocket = io!.sockets.sockets.get(partnerId);

        if (!partnerSocket) {
          waitingQueue.push(socket.id);
          socket.emit("waiting");
          return;
        }

        activePairs[socket.id] = partnerId;
        activePairs[partnerId] = socket.id;

        const topic = getRandomTopic();
        socket.emit("partner-found", { initiator: true, topic });
        partnerSocket.emit("partner-found", { initiator: false, topic });
      } else {
        waitingQueue.push(socket.id);
        socket.emit("waiting");
      }
    });

    socket.on("signal", (data: unknown) => {
      const partnerId = activePairs[socket.id];
      if (partnerId) io!.to(partnerId).emit("signal", data);
    });

    socket.on("skip", () => {
      const partnerId = activePairs[socket.id];
      if (partnerId) {
        io!.to(partnerId).emit("partner-left");
        delete activePairs[partnerId];
      }
      delete activePairs[socket.id];
      waitingQueue.push(socket.id);
      socket.emit("waiting");
    });

    socket.on("disconnect", () => {
      waitingQueue = waitingQueue.filter((id) => id !== socket.id);
      const partnerId = activePairs[socket.id];
      if (partnerId) {
        io!.to(partnerId).emit("partner-left");
        delete activePairs[partnerId];
      }
      delete activePairs[socket.id];
    });
  });

  return io;
}