const { createServer } = require("http")
const { Server } = require("socket.io")
const { MongoClient } = require("mongodb")
const dotenv = require("dotenv")
dotenv.config();
// MongoDB connection
let db = null

async function connectToDatabase() {
  if (db) return db
   
  const client = new MongoClient(process.env.MONGODB_URI)
  await client.connect()
  db = client.db("MV-LIVE")
  console.log(db);
  console.log("Connected to MongoDB")
  return db
}

// Room service functions
async function getRoomByCode(roomCode) {
  const database = await connectToDatabase()
  return await database.collection("rooms").findOne({ roomCode, isActive: true })
}

async function updateVideoState(roomCode, currentTime, isPlaying) {
  const database = await connectToDatabase()
  await database.collection("rooms").updateOne(
    { roomCode, isActive: true },
    {
      $set: {
        currentTime,
        isPlaying,
        updatedAt: new Date(),
      },
    },
  )
}

async function endRoom(roomCode) {
  const database = await connectToDatabase()
  await database.collection("rooms").updateOne(
    { roomCode },
    {
      $set: {
        isActive: false,
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  )
}

// Create HTTP server
const httpServer = createServer()

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "https://mv-live.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  allowEIO3: true,
  transports: ["websocket", "polling"],
})

// Socket event handlers
io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  // Join room
  socket.on("join-room", async (roomCode, userId) => {
    socket.join(roomCode)
    socket.to(roomCode).emit("user-joined", userId)
    console.log(`User ${userId} joined room ${roomCode}`)

    // Send current video state to new user
    try {
      const room = await getRoomByCode(roomCode)
      if (room) {
        socket.emit("video-sync", {
          currentTime: room.currentTime || 0,
          isPlaying: room.isPlaying || false,
        })
      }
    } catch (error) {
      console.error("Error syncing video state:", error)
    }
  })

  // Leave room
  socket.on("leave-room", (roomCode, userId) => {
    socket.leave(roomCode)
    socket.to(roomCode).emit("user-left", userId)
    console.log(`User ${userId} left room ${roomCode}`)
  })

  // Video control synchronization
  socket.on("video-control", async (roomCode, action, data) => {
    try {
      // Update room state in database
      if (action === "play" || action === "pause") {
        await updateVideoState(roomCode, data.currentTime || 0, action === "play")
      } else if (action === "seek") {
        await updateVideoState(roomCode, data.currentTime, data.isPlaying)
      }

      // Broadcast to all users in room
      io.to(roomCode).emit("video-control", action, data)
    } catch (error) {
      console.error("Error handling video control:", error)
    }
  })

  // Chat messages
  socket.on("chat-message", (roomCode, message) => {
    io.to(roomCode).emit("chat-message", message)
  })

  // WebRTC signaling
  socket.on("webrtc-offer", (roomCode, offer, targetUserId) => {
    socket.to(roomCode).emit("webrtc-offer", offer, socket.id)
  })

  socket.on("webrtc-answer", (roomCode, answer, targetUserId) => {
    socket.to(roomCode).emit("webrtc-answer", answer, socket.id)
  })

  socket.on("webrtc-ice-candidate", (roomCode, candidate, targetUserId) => {
    socket.to(roomCode).emit("webrtc-ice-candidate", candidate, socket.id)
  })

  // Room ended by host
  socket.on("end-room", async (roomCode, userId) => {
    try {
      const room = await getRoomByCode(roomCode)
      if (room && room.hostId === userId) {
        // Notify all users that room is ending
        io.to(roomCode).emit("room-ended")

        // End room and cleanup
        await endRoom(roomCode)

        console.log(`Room ${roomCode} ended by host ${userId}`)
      }
    } catch (error) {
      console.error("Error ending room:", error)
    }
  })

  // Disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)
  })
})
 if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI environment variable is not set")
    }
// Start server
const PORT = process.env.SOCKET_PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully")
  httpServer.close(() => {
    console.log("Socket.IO server closed")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully")
  httpServer.close(() => {
    console.log("Socket.IO server closed")
    process.exit(0)
  })
})

