const jwt = require("jsonwebtoken");
const secret = "your_jwt_secret"; // strong env var मध्ये ठेव

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // Dummy user check (replace with DB logic)
  const user = await User.findOne({ email });
  if (!user || user.password !== password) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Token तयार कर
  const token = jwt.sign({ id: user._id }, secret, { expiresIn: "1d" });

  // Client ला पाठव
  res.json({ token, user });
});
