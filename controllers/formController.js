router.post('/', upload.single('file'), async (req, res) => {
  const { name, email, number, age, gender, location } = req.body;
  const file = req.file ? req.file.filename : '';

  const newForm = new Form({
    name,
    email,
    number,
    age: Number(age), // make sure age is a number
    gender,
    location,
    file
  });

  try {
    await newForm.save();
    res.status(201).json({ message: 'Form submitted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save form data' });
  }
});
