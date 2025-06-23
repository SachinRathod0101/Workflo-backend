const mongoose = require("mongoose");

const storySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  url: { type: String, required: true },
  fileType: { type: String, required: true }, // e.g., "image/jpeg", "video/mp4"
  createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 }, // Auto-delete after 24 hours
});

module.exports = mongoose.model("Story", storySchema);