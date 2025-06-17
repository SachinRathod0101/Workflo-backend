const express = require('express');
const router = express.Router();
const User = require('../models/User');


router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user) return res.status(400).json({ message: 'Invalid credentials' });
  if (user.password !== password) return res.status(400).json({ message: 'Invalid credentials' });

  res.json({
    message: 'Login successful',
    user: {
      username: user.username,
      email: user.email,
      name: user.name, 
    }
  });
});


module.exports = router;
