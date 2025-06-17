const express = require('express');
const multer = require('multer');
const path = require('path');
const Form = require('../models/Request');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// Form Submit Route
router.post('/submit', upload.single('file'), async (req, res) => {
  const { name, email, number, age, gender, location } = req.body;
  const file = req.file?.filename || '';

  const newForm = new Form({
    name,
    email,
    number,
    age,
    gender,
    location,
    file
  });

  try {
    await newForm.save();
    res.status(201).json({ message: 'Form submitted successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save request' });
  }
});

// Get Pending Requests
router.get('/requests', async (req, res) => {
  try {
    const requests = await Form.find({ approved: false });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Approve Request
const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

// Utility to generate username and password
const generateUsername = (email) => email.split("@")[0];
const generatePassword = () => Math.random().toString(36).slice(-8);

// Approve User and Send Email
const approveUser = async (req, res) => {
  const { id } = req.body;

  try {
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update status & credentials
    user.status = "approved";
    const username = generateUsername(user.email);
    const password = generatePassword();

    user.username = username;
    user.password = password;
    await user.save();

    // Send Email
    await sendEmail(user.email, user.name, username, password);

    res.status(200).json({ message: "✅ User approved and email sent successfully!" });
  } catch (error) {
    console.error("❌ Error during user approval:", error);
    res.status(500).json({ message: "Error approving user" });
  }
};

module.exports = approveUser;




module.exports = router;
