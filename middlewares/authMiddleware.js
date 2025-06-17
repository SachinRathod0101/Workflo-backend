const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();

// Ensure JWT_SECRET is available
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not defined in environment variables");
  process.exit(1);
}

/**
 * Middleware to authenticate requests using JWT.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token missing or invalid format" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token not provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id; // Changed from decoded.userId to decoded.id to match login payload
    if (!req.userId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired", expired: true });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token" });
    }
    console.error("JWT Error:", {
      message: err.message,
      name: err.name,
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({ message: "Authentication failed" });
  }
};

module.exports = authMiddleware;