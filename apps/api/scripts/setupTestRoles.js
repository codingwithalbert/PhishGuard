require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../src/models/User");

async function setupTestRoles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const staff = await User.findOneAndUpdate(
      { email: "staff@test.com" },
      { role: "staff" },
      { returnDocument: "after" }
    );

    const admin = await User.findOneAndUpdate(
      { email: "admin@test.com" },
      { role: "admin" },
      { returnDocument: "after" }
    );

    if (!staff || !admin) {
      throw new Error("Test staff or admin account was not found");
    }

    console.log("Staff role:", staff.role);
    console.log("Admin role:", admin.role);
  } catch (error) {
    console.error("Role setup failed:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

setupTestRoles();