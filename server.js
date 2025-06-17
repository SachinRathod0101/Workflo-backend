require("dotenv").config();
console.log("Step 1: Loaded environment variables");

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const fs = require("fs");
const { Buffer } = require("buffer");
const sendEmail = require("./utils/sendEmail");
const User = require("./models/User");
const Form = require("./models/Request");
const userRoutes = require("./routes/userRoutes");

console.log("Step 2: Imported all dependencies");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const allowedOrigins = ["http://localhost:3000", "http://localhost:5173"];
const uploadsDir = path.join(__dirname, "Uploads");

console.log("Step 3: Defined constants - PORT:", PORT, "Uploads Dir:", uploadsDir);

// Create Uploads directory
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log("Step 4: Created Uploads directory");
} else {
  console.log("Step 4: Uploads directory already exists");
}

// Middleware
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));
console.log("Step 5: Middleware setup completed");

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});
console.log("Step 6: Cloudinary configured");

// Multer Configuration for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "Uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed!"), false);
  },
});
console.log("Step 7: Multer configured for PDF uploads");

// Authentication Middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Authentication required" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    console.log("Auth Middleware: User authenticated, userId:", req.userId);
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Utility Functions
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const deleteFile = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) console.error("Error deleting file:", err);
    else console.log("File deleted:", filePath);
  });
};
console.log("Step 8: Utility functions defined");

// Socket.io Server
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
});
console.log("Step 9: Socket.io server initialized");

// Routes
app.use("/api/users", userRoutes);
app.use("/api/posts", require("./routes/postRoutes")(io));
console.log("Step 10: API routes setup completed");

// Follow/Unfollow/Block/Unblock Routes
app.post("/api/users/:id/follow", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
    console.log("Follow Route: userId:", userId, "targetUserId:", targetUserId);

    if (!isValidObjectId(userId) || !isValidObjectId(targetUserId))
      return res.status(400).json({ message: "Invalid user ID" });
    if (userId === targetUserId)
      return res.status(400).json({ message: "Cannot follow yourself" });

    const [currentUser, targetUser] = await Promise.all([
      User.findById(userId),
      User.findById(targetUserId),
    ]);
    if (!currentUser || !targetUser)
      return res.status(404).json({ message: "User not found" });
    if (targetUser.blockedUsers.includes(userId))
      return res.status(403).json({ message: "Cannot follow a user who has blocked you" });

    if (!currentUser.following.includes(targetUserId)) currentUser.following.push(targetUserId);
    if (!targetUser.followers.includes(userId)) targetUser.followers.push(userId);
    await Promise.all([currentUser.save(), targetUser.save()]);

    io.emit("userFollowed", { followerId: userId, userId: targetUserId });
    io.to(targetUserId).emit("notification", {
      type: "follow",
      message: `${currentUser.name} followed you`,
      fromUserId: userId,
    });

    res.json({ message: "Followed successfully" });
  } catch (err) {
    console.error("Follow error:", err.message);
    res.status(500).json({ message: "Failed to follow user" });
  }
});

app.post("/api/users/:id/unfollow", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
    console.log("Unfollow Route: userId:", userId, "targetUserId:", targetUserId);

    if (!isValidObjectId(userId) || !isValidObjectId(targetUserId))
      return res.status(400).json({ message: "Invalid user ID" });
    if (userId === targetUserId)
      return res.status(400).json({ message: "Cannot unfollow yourself" });

    const [currentUser, targetUser] = await Promise.all([
      User.findById(userId),
      User.findById(targetUserId),
    ]);
    if (!currentUser || !targetUser)
      return res.status(404).json({ message: "User not found" });

    currentUser.following = currentUser.following.filter((id) => id.toString() !== targetUserId);
    targetUser.followers = targetUser.followers.filter((id) => id.toString() !== userId);
    await Promise.all([currentUser.save(), targetUser.save()]);

    io.emit("userUnfollowed", { followerId: userId, userId: targetUserId });
    res.json({ message: "Unfollowed successfully" });
  } catch (err) {
    console.error("Unfollow error:", err.message);
    res.status(500).json({ message: "Failed to unfollow user" });
  }
});

app.post("/api/users/:id/block", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
    console.log("Block Route: userId:", userId, "targetUserId:", targetUserId);

    if (!isValidObjectId(userId) || !isValidObjectId(targetUserId))
      return res.status(400).json({ message: "Invalid user ID" });
    if (userId === targetUserId)
      return res.status(400).json({ message: "Cannot block yourself" });

    const [currentUser, targetUser] = await Promise.all([
      User.findById(userId),
      User.findById(targetUserId),
    ]);
    if (!currentUser || !targetUser)
      return res.status(404).json({ message: "User not found" });

    if (!currentUser.blockedUsers.includes(targetUserId)) {
      currentUser.blockedUsers.push(targetUserId);
      currentUser.following = currentUser.following.filter((id) => id.toString() !== targetUserId);
      targetUser.followers = targetUser.followers.filter((id) => id.toString() !== userId);
      await Promise.all([currentUser.save(), targetUser.save()]);
    }

    io.emit("userBlocked", { blockerId: userId, userId: targetUserId });
    res.json({ message: "Blocked successfully" });
  } catch (err) {
    console.error("Block error:", err.message);
    res.status(500).json({ message: "Failed to block user" });
  }
});

app.post("/api/users/:id/unblock", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
    console.log("Unblock Route: userId:", userId, "targetUserId:", targetUserId);

    if (!isValidObjectId(userId) || !isValidObjectId(targetUserId))
      return res.status(400).json({ message: "Invalid user ID" });
    if (userId === targetUserId)
      return res.status(400).json({ message: "Cannot unblock yourself" });

    const currentUser = await User.findById(userId);
    if (!currentUser) return res.status(404).json({ message: "Current user not found" });

    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (id) => id.toString() !== targetUserId
    );
    await currentUser.save();

    io.emit("userUnblocked", { blockerId: userId, userId: targetUserId });
    res.json({ message: "Unblocked successfully" });
  } catch (err) {
    console.error("Unblock error:", err.message);
    res.status(500).json({ message: "Failed to unblock user" });
  }
});

// Form Submission
app.post("/api/form/submit", upload.single("file"), async (req, res) => {
  const { name, number, email, age, gender, location } = req.body;
  const file = req.file;
  console.log("Form Submit Route: Received data:", req.body, "File:", file);

  if (!name || !number || !email || !age || !gender || !location || !file)
    return res.status(400).json({ message: "All fields are required" });

  try {
    const newForm = new Form({
      name,
      number,
      email,
      age,
      gender,
      location,
      file: `/Uploads/${file.filename}`,
      approved: false,
    });
    await newForm.save();
    console.log("Form Submit Route: Form saved successfully");
    res.status(200).json({ message: "Form submitted successfully!" });
  } catch (err) {
    console.error("Submission error:", err.message);
    res.status(500).json({ message: "Submission error" });
  }
});

// Convert Base64 to PDF
app.post("/api/form/convert-base64", async (req, res) => {
  const { id, base64Data } = req.body;
  console.log("Convert Base64 Route: id:", id);

  if (!id || !base64Data) return res.status(400).json({ message: "ID and Base64 data required" });
  if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid form ID" });

  try {
    const fileData = Buffer.from(base64Data, "base64");
    const fileName = `decoded_${id}.pdf`;
    const filePath = path.join(__dirname, "Uploads", fileName);

    fs.writeFileSync(filePath, fileData);
    await Form.findByIdAndUpdate(id, { file: `/Uploads/${fileName}` });
    console.log("Convert Base64 Route: File saved and form updated");

    res.status(200).json({ message: "Base64 converted and saved successfully!" });
  } catch (err) {
    console.error("Base64 conversion error:", err.message);
    res.status(500).json({ message: "Base64 conversion error" });
  }
});

// Cloudinary Upload
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    console.log("Cloudinary Upload Route: Uploading file:", req.file.path);
    const result = await cloudinary.uploader.upload(req.file.path);
    deleteFile(req.file.path);
    console.log("Cloudinary Upload Route: File uploaded to Cloudinary");
    res.json({ imageUrl: result.secure_url });
  } catch (err) {
    console.error("Cloudinary upload error:", err.message);
    res.status(500).json({ message: "Upload failed" });
  }
});

// Approve Form
app.post("/api/form/approve", async (req, res) => {
  const { id } = req.body;
  console.log("Approve Form Route: id:", id);

  if (!id || !isValidObjectId(id)) return res.status(400).json({ message: "Valid form ID required" });

  try {
    const submission = await Form.findById(id);
    if (!submission) return res.status(404).json({ message: "Form not found" });

    submission.approved = true;
    await submission.save();

    const username = submission.email.split("@")[0];
    const password = Math.random().toString(36).slice(-8);

    const newUser = new User({
      name: submission.name,
      email: submission.email,
      number: submission.number,
      username,
      password,
      age: submission.age,
      gender: submission.gender,
      location: submission.location,
      profileImage: "https://cdn-icons-png.flaticon.com/512/847/847969.png",
      followers: [],
      following: [],
      blockedUsers: [],
    });

    await newUser.save();
    await sendEmail(submission.email, submission.name, username, password);
    console.log("Approve Form Route: User created and email sent");

    res.json({ message: "Approved, user created & email sent" });
  } catch (err) {
    console.error("Approval error:", err.message);
    res.status(500).json({ message: "Approval error" });
  }
});

// Reject Form
app.post("/api/form/reject", async (req, res) => {
  const { id } = req.body;
  console.log("Reject Form Route: id:", id);

  if (!id || !isValidObjectId(id)) return res.status(400).json({ message: "Valid form ID required" });

  try {
    const submission = await Form.findById(id);
    if (!submission) return res.status(404).json({ message: "Form not found" });

    const filePath = path.join(__dirname, submission.file);
    deleteFile(filePath);
    await Form.findByIdAndDelete(id);
    console.log("Reject Form Route: Form deleted");

    res.json({ message: "Rejected and removed" });
  } catch (err) {
    console.error("Reject error:", err.message);
    res.status(500).json({ message: "Reject error" });
  }
});

// Get Pending Forms
app.get("/api/form/requests", async (req, res) => {
  try {
    const pending = await Form.find({ approved: false });
    console.log("Get Pending Forms Route: Fetched pending forms");
    res.json(pending);
  } catch (err) {
    console.error("Error fetching requests:", err.message);
    res.status(500).json({ message: "Error fetching requests" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("Login Route: username:", username);

  if (!username || !password)
    return res.status(400).json({ message: "Username and password required" });

  try {
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    console.log("Login Route: Login successful, userId:", user._id);
    res.json({ message: "Login successful", user, token });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Login error" });
  }
});

// Socket.io Events
const onlineUsers = [];

io.on("connection", (socket) => {
  console.log("Step 11: Socket.io - New client connected:", socket.id);

  // Authenticate Socket Connection
  const token = socket.handshake.auth.token;
  let userId;
  try {
    if (!token) throw new Error("Authentication required");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
    console.log("Socket Auth: User authenticated, userId:", userId);
  } catch (err) {
    console.error("Socket auth error:", err.message);
    socket.emit("authError", { message: "Invalid or expired token" });
    socket.disconnect();
    return;
  }

  // Add user to online list
  socket.on("addUser", (id) => {
    if (id === userId && !onlineUsers.includes(userId)) {
      onlineUsers.push(userId);
      socket.join(userId);
      io.emit("getOnlineUsers", onlineUsers);
      console.log("Socket Event: Added user to online list:", userId, "Online users:", onlineUsers);
    }
  });

  // WebRTC Signaling for Voice Calls
  socket.on("callUser", async (data) => {
    const { to, from, offer } = data;
    console.log("Socket Event: callUser - from:", from, "to:", to);
    if (from !== userId) return socket.emit("callError", { message: "Unauthorized caller" });

    try {
      const targetUser = await User.findById(to);
      if (!targetUser) return socket.emit("callError", { message: "User not found" });
      if (targetUser.blockedUsers.includes(from))
        return socket.emit("callError", { message: "You are blocked by this user" });

      if (onlineUsers.includes(to)) {
        socket.to(to).emit("callUser", { from, offer });
        console.log("Socket Event: callUser - Offer sent to:", to);
      } else {
        socket.emit("callError", { message: "User is offline" });
        console.log("Socket Event: callUser - User offline:", to);
      }
    } catch (err) {
      console.error("Call error:", err.message);
      socket.emit("callError", { message: "Failed to initiate call" });
    }
  });

  socket.on("answerCall", (data) => {
    const { to, answer } = data;
    console.log("Socket Event: answerCall - to:", to);
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("callAccepted", { answer });
      console.log("Socket Event: answerCall - Answer sent to:", to);
    }
  });

  socket.on("iceCandidate", (data) => {
    const { to, candidate } = data;
    console.log("Socket Event: iceCandidate - to:", to);
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("iceCandidate", { candidate });
      console.log("Socket Event: iceCandidate - Candidate sent to:", to);
    }
  });

  socket.on("endCall", (data) => {
    const { to } = data;
    console.log("Socket Event: endCall - to:", to);
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("callEnded");
      console.log("Socket Event: endCall - Call ended signal sent to:", to);
    }
  });

  socket.on("rejectCall", (data) => {
    const { to } = data;
    console.log("Socket Event: rejectCall - to:", to);
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("callRejected");
      console.log("Socket Event: rejectCall - Call rejected signal sent to:", to);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket Event: Client disconnected:", socket.id);
    if (onlineUsers.includes(userId)) {
      onlineUsers.splice(onlineUsers.indexOf(userId), 1);
      io.emit("getOnlineUsers", onlineUsers);
      console.log("Socket Event: User removed from online list:", userId, "Online users:", onlineUsers);
    }
  });
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Step 12: MongoDB connected successfully");
    server.listen(PORT, () => console.log(`Step 13: Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Step 12: DB connection error:", err.message);
    process.exit(1); // Exit if DB connection fails
  });