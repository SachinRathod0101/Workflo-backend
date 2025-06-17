const express = require('express');
const router = express.Router();
const Request = require('../models/Request');
const sendEmail = require('../utils/sendEmail');
const bcrypt = require('bcrypt');

router.get('/requests', async (req, res) => {
  const requests = await Request.find({ status: 'pending' });
  res.send(requests);
});

router.post('/approve', async (req, res) => {
  const { id } = req.body;
  const user = await Request.findById(id);
  const username = user.email.split('@')[0];
  const password = Math.random().toString(36).slice(-8);
  const passwordHash = await bcrypt.hash(password, 10);

  await Request.findByIdAndUpdate(id, { status: 'approved', passwordHash });

  await sendEmail(user.email, username, password);
  res.send({ message: 'Approved and email sent' });
});

module.exports = router;
