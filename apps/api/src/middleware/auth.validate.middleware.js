function validateRegistration(req, res, next) {
  const { name, email, password } = req.body;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({
      success: false,
      error: "Name, email, and password are required"
    });
  }

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (trimmedName.length < 2 || trimmedName.length > 50) {
    return res.status(400).json({
      success: false,
      error: "Name must be between 2 and 50 characters"
    });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) {
    return res.status(400).json({
      success: false,
      error: "A valid email address is required"
    });
  }

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({
      success: false,
      error: "Password must be between 8 and 128 characters"
    });
  }

  req.body.name = trimmedName;
  req.body.email = normalizedEmail;

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body;

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({
      success: false,
      error: "Email and password are required"
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail.length === 0 || password.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Email and password are required"
    });
  }

  if (normalizedEmail.length > 254 || password.length > 128) {
    return res.status(400).json({
      success: false,
      error: "Invalid login input"
    });
  }

  req.body.email = normalizedEmail;

  next();
}

module.exports = {
  validateRegistration,
  validateLogin
};