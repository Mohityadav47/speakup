import { createServer } from "http";
import { initSocket } from "@/lib/socketServer";

let started = false;

export async function GET() {
  if (!started) {
    started = true;
    const httpServer = createServer();
    initSocket(httpServer);
    httpServer.listen(3001, () => {
      console.log("Socket.io running on port 3001");
    });
  }
  return new Response("Socket server running", { status: 200 });
}