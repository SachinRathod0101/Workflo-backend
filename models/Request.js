const mongoose = require('mongoose');

const formSchema = new mongoose.Schema({
  name: String,
  number: String,
  email: String,
  age: Number,
  gender: String,
  location: String,
  file: String, // Store the full relative path
  approved: Boolean,
});

module.exports = mongoose.model('Form', formSchema, 'requests');