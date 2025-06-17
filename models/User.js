const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  username: { type: String, unique: true },
  number: { type: String },
  age: { type: Number },
  
  gender: { type: String },
  location: { type: String },
  profileImage: { type: String, default: "https://cdn-icons-png.flaticon.com/512/847/847969.png" },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: [] }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", default: [] }],
});

module.exports = mongoose.model("User", userSchema);