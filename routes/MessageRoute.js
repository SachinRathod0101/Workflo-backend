const express = require('express');
const Message = require('../models/Message');
const router = express.Router();


router.post('/', async (req, res) => {
  const { senderId, receiverId, message } = req.body;

  try {
    const newMessage = new Message({ senderId, receiverId, message });
    await newMessage.save();
    res.status(201).json(newMessage);
  } catch (err) {
    console.error('Error saving message:', err);
    res.status(500).json({ message: 'Failed to save message' });
  }
});


router.get('/me/:userId', async (req, res) => {
  const { userId } = req.params;
  const { senderId } = req.query; 

  try {
    const messages = await Message.find({
      $or: [
        { senderId, receiverId: userId },
        { senderId: userId, receiverId: senderId },
      ],
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
});

module.exports = router;