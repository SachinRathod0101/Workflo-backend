require("dotenv").config();
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
const twilio = require("twilio");
const sendEmail = require("./utils/sendEmail");
const User = require("./models/User");
const Form = require("./models/Request");
const Story = require("./models/Story"); // Added
const userRoutes = require("./routes/userRoutes");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "https://sunny-dango-9beaf5.netlify.app",
];

app.use(cors({ origin: allowedOrigins, credentials: true }));

const uploadsDir = path.join(__dirname, "Uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use(express.json());
app.use("/uploads", express.static("uploads"));

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "Uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "video/mp4", "video/webm"];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only images (JPEG, PNG, GIF) and videos (MP4, WebM) are allowed!"), false);
  },
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit
});

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Authentication required" });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const deleteFile = (filePath) => {
  fs.unlink(filePath, (err) => err && console.error("Error deleting file:", err));
};

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
});

app.use("/api/users", userRoutes);
app.use("/api/posts", require("./routes/postRoutes")(io));

app.get("/api/stories", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    if (!isValidObjectId(userId)) return res.status(400).json({ message: "Invalid user ID" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const followingIds = [...user.following, userId]; // Include the user's own stories

    const stories = await Story.find({ userId: { $in: followingIds } })
      .populate("userId", "name profileImage")
      .sort({ createdAt: -1 });

    res.json(stories);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch stories" });
  }
});

app.post("/api/stories/add", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    const { userId } = req;
    const file = req.file;
    if (!file) return res.status(400).json({ message: "File is required" });
    if (!isValidObjectId(userId)) return res.status(400).json({ message: "Invalid user ID" });

    if (file.mimetype.startsWith("video/")) {
      const videoPath = path.join("Uploads", file.filename);
      const { duration } = await new Promise((resolve, reject) => {
        require("ffmpeg-static");
        const ffmpeg = require("fluent-ffmpeg")();
        ffmpeg.input(videoPath).ffprobe((err, metadata) => {
          if (err) reject(err);
          else resolve(metadata.format);
        });
      });
      if (duration > 30) {
        deleteFile(videoPath);
        return res.status(400).json({ message: "Video must be 30 seconds or less" });
      }
    }

    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: file.mimetype.startsWith("video/") ? "video" : "image",
    });
    deleteFile(file.path);

    const story = new Story({
      userId,
      url: result.secure_url,
      fileType: file.mimetype,
    });
    await story.save();

    io.emit("newStory", story);
    res.json(story);
  } catch (err) {
    if (req.file) deleteFile(req.file.path);
    res.status(500).json({ message: "Failed to upload story" });
  }
});

app.post("/api/users/:id/follow", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
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
    res.status(500).json({ message: "Failed to follow user" });
  }
});

app.post("/api/users/:id/unfollow", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
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
    res.status(500).json({ message: "Failed to unfollow user" });
  }
});

app.post("/api/users/:id/block", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
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
    res.status(500).json({ message: "Failed to block user" });
  }
});

app.post("/api/users/:id/unblock", authMiddleware, async (req, res) => {
  try {
    const { userId } = req;
    const targetUserId = req.params.id;
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
    res.status(500).json({ message: "Failed to unblock user" });
  }
});

app.post("/api/form/submit", upload.single("file"), async (req, res) => {
  const { name, number, email, age, gender, location } = req.body;
  const file = req.file;
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
    res.status(200).json({ message: "Form submitted successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Submission error" });
  }
});

app.post("/api/form/convert-base64", async (req, res) => {
  const { id, base64Data } = req.body;
  if (!id || !base64Data) return res.status(400).json({ message: "ID and Base64 data required" });
  if (!isValidObjectId(id)) return res.status(400).json({ message: "Invalid form ID" });

  try {
    const fileData = Buffer.from(base64Data, "base64");
    const fileName = `decoded_${id}.pdf`;
    const filePath = path.join(__dirname, "Uploads", fileName);

    fs.writeFileSync(filePath, fileData);
    await Form.findByIdAndUpdate(id, { file: `/Uploads/${fileName}` });
    res.status(200).json({ message: "Base64 converted and saved successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Base64 conversion error" });
  }
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    deleteFile(req.file.path);
    res.json({ imageUrl: result.secure_url });
  } catch (err) {
    res.status(500).json({ message: "Upload failed" });
  }
});

app.post("/api/form/approve", async (req, res) => {
  const { id } = req.body;
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
    res.json({ message: "Approved, user created & email sent" });
  } catch (err) {
    res.status(500).json({ message: "Approval error" });
  }
});

app.post("/api/form/reject", async (req, res) => {
  const { id } = req.body;
  if (!id || !isValidObjectId(id)) return res.status(400).json({ message: "Valid form ID required" });

  try {
    const submission = await Form.findById(id);
    if (!submission) return res.status(404).json({ message: "Form not found" });

    const filePath = path.join(__dirname, submission.file);
    deleteFile(filePath);
    await Form.findByIdAndDelete(id);
    res.json({ message: "Rejected and removed" });
  } catch (err) {
    res.status(500).json({ message: "Reject error" });
  }
});

app.get("/api/form/requests", async (req, res) => {
  try {
    const pending = await Form.find({ approved: false });
    res.json(pending);
  } catch (err) {
    res.status(500).json({ message: "Error fetching requests" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: "Username and password required" });

  try {
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ message: "Login successful", user, token });
  } catch (err) {
    res.status(500).json({ message: "Login error" });
  }
});

app.post("/api/send-sms", authMiddleware, async (req, res) => {
  const { to, message } = req.body;
  const { userId } = req;

  if (!to || !message)
    return res.status(400).json({ message: "Phone number and message are required" });

  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  if (!phoneRegex.test(to))
    return res.status(400).json({ message: "Invalid phone number format. Use E.164 format (e.g., +919876543210)" });

  try {
    const sms = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to,
    });

    io.to(userId).emit("smsSent", { to, message, timestamp: Date.now() });
    res.status(200).json({ message: "SMS sent successfully", sid: sms.sid });
  } catch (err) {
    res.status(500).json({ message: "Failed to send SMS", error: err.message });
  }
});

const onlineUsers = [];

io.on("connection", (socket) => {
  const token = socket.handshake.auth.token;
  let userId;
  try {
    if (!token) throw new Error("Authentication required");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch (err) {
    socket.emit("authError", { message: "Invalid or expired token" });
    socket.disconnect();
    return;
  }

  socket.on("addUser", (id) => {
    if (id === userId && !onlineUsers.includes(userId)) {
      onlineUsers.push(userId);
      socket.join(userId);
      io.emit("getOnlineUsers", onlineUsers);
    }
  });

  socket.on("callUser", async (data) => {
    const { to, from, offer } = data;
    if (from !== userId) return socket.emit("callError", { message: "Unauthorized caller" });

    try {
      const targetUser = await User.findById(to);
      if (!targetUser) return socket.emit("callError", { message: "User not found" });
      if (targetUser.blockedUsers.includes(from))
        return socket.emit("callError", { message: "You are blocked by this user" });

      if (onlineUsers.includes(to)) {
        socket.to(to).emit("callUser", { from, offer });
      } else {
        socket.emit("callError", { message: "User is offline" });
      }
    } catch (err) {
      socket.emit("callError", { message: "Failed to initiate call" });
    }
  });

  socket.on("answerCall", (data) => {
    const { to, answer } = data;
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("callAccepted", { answer });
    }
  });

  socket.on("iceCandidate", (data) => {
    const { to, candidate } = data;
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("iceCandidate", { candidate });
    }
  });

  socket.on("endCall", (data) => {
    const { to } = data;
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("callEnded");
    }
  });

  socket.on("rejectCall", (data) => {
    const { to } = data;
    if (onlineUsers.includes(to)) {
      socket.to(to).emit("callRejected");
    }
  });

  socket.on("deleteStory", async (storyId) => {
    try {
      if (!isValidObjectId(storyId)) return;
      await Story.findByIdAndDelete(storyId);
      io.emit("deleteStory", storyId);
    } catch (err) {
      console.error("Error deleting story:", err);
    }
  });

  socket.on("disconnect", () => {
    if (onlineUsers.includes(userId)) {
      onlineUsers.splice(onlineUsers.indexOf(userId), 1);
      io.emit("getOnlineUsers", onlineUsers);
    }
  });
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB connection error:", err.message);
    process.exit(1);
  });