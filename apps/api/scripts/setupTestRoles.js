require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const readline = require("readline");
const User = require("../src/models/User");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function setupTestRoles() {
  try {
    const staffPassword = await askQuestion(
      "Enter a new password for staff@test.com: "
    );

    const adminPassword = await askQuestion(
      "Enter a new password for admin@test.com: "
    );

    if (staffPassword.length < 8 || adminPassword.length < 8) {
      throw new Error(
        "Both passwords must contain at least 8 characters"
      );
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const staffPasswordHash = await bcrypt.hash(
      staffPassword,
      12
    );

    const adminPasswordHash = await bcrypt.hash(
      adminPassword,
      12
    );

    const staff = await User.findOneAndUpdate(
      { email: "staff@test.com" },
      {
        role: "staff",
        password: staffPasswordHash
      },
      { returnDocument: "after" }
    );

    const admin = await User.findOneAndUpdate(
      { email: "admin@test.com" },
      {
        role: "admin",
        password: adminPasswordHash
      },
      { returnDocument: "after" }
    );

    if (!staff || !admin) {
      throw new Error(
        "Test staff or admin account was not found"
      );
    }

    console.log("");
    console.log("Test accounts updated successfully.");
    console.log("Staff:", staff.email, "-", staff.role);
    console.log("Admin:", admin.email, "-", admin.role);
    console.log("Passwords were stored as bcrypt hashes.");
  } catch (error) {
    console.error("Test account setup failed:", error.message);
  } finally {
    rl.close();

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

setupTestRoles();