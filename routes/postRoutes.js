const express = require("express");
const router = express.Router();
const Post = require("../models/Post");
const User = require("../models/User");
const multer = require("multer");
const path = require("path");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Factory function to pass io instance
module.exports = (io) => {
  // ➕ Add Post
  router.post("/addPost", upload.single("image"), async (req, res) => {
    const { caption, userId } = req.body;

    if (!caption || !req.file || !userId) {
      return res.status(400).json({ message: "Caption, image, and userId are required!" });
    }

    try {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const result = await cloudinary.uploader.upload(req.file.path);
      const newPost = new Post({
        caption,
        imageUrl: result.secure_url,
        user: userId,
        likes: [],
        comments: [],
      });
      await newPost.save();
      const populatedPost = await Post.findById(newPost._id).populate("user", "name profileImage");
      console.log("Emitting newPost:", populatedPost); // Debug log
      io.emit("newPost", populatedPost); // Emit new post event
      res.status(201).json(populatedPost);
    } catch (err) {
      console.error("Error adding post:", err);
      res.status(500).json({ message: "Error adding post" });
    }
  });

  // 📥 Get All Posts
  router.get("/getPosts", async (req, res) => {
    try {
      const posts = await Post.find()
        .sort({ createdAt: -1 })
        .populate("user", "name profileImage")
        .populate("comments.user", "name");
      res.json(posts.map(post => ({
        ...post.toObject(),
        likes: Array.isArray(post.likes) ? post.likes : [],
        comments: Array.isArray(post.comments) ? post.comments : [],
      })));
    } catch (err) {
      console.error("Error fetching posts:", err);
      res.status(500).json({ message: "Error fetching posts" });
    }
  });

  // 👍 Like Post
  router.post("/:id/like", async (req, res) => {
    try {
      const post = await Post.findById(req.params.id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      if (post.likes.includes(req.body.userId)) {
        post.likes = post.likes.filter((id) => id.toString() !== req.body.userId);
      } else {
        post.likes.push(req.body.userId);
      }
      await post.save();
      const populatedPost = await Post.findById(post._id)
        .populate("user", "name profileImage")
        .populate("comments.user", "name");
      io.emit("postUpdated", populatedPost); // Emit updated post event
      res.json(populatedPost);
    } catch (err) {
      console.error("Error liking post:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // 💬 Add Comment
  router.post("/:id/comment", async (req, res) => {
    try {
      const post = await Post.findById(req.params.id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      const comment = {
        user: req.body.userId,
        text: req.body.text,
        createdAt: new Date(),
      };
      post.comments.push(comment);
      await post.save();
      const populatedPost = await Post.findById(post._id)
        .populate("user", "name profileImage")
        .populate("comments.user", "name");
      io.emit("postUpdated", populatedPost); // Emit updated post event
      res.json({ comment });
    } catch (err) {
      console.error("Error adding comment:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};