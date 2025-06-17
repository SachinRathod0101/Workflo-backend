const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  profilePic: { type: String },  // Optional profile picture URL
});

module.exports = mongoose.model("User", userSchema);
