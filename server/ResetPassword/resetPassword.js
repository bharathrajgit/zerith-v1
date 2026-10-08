require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("readline");

const MONGO_URI = process.env.MONGO_URI || "";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function resetInstitutionPassword() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("Connected to MongoDB target:", mongoose.connection.db ? mongoose.connection.db.databaseName : MONGO_URI.replace(/\/\/.*@/, '//***@').split('/').pop());

    const email = (await ask("Enter Gmail / Email: "))
      .trim()
      .toLowerCase();

    const newPassword = await ask("Enter new password: ");

    if (!email || !newPassword) {
      console.log("Email and password are required.");
      return;
    }

    if (newPassword.length < 8) {
      console.log("Password must be at least 8 characters.");
      return;
    }

    const users = mongoose.connection.collection("users");

    const user = await users.findOne({ email });

    if (!user) {
      console.log(`No user account found for: ${email}`);
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
      }
    );

    console.log("User password reset successful.");
    console.log(`Email: ${email}`);
    console.log(`User ID: ${user._id}`);
  } catch (error) {
    console.error("Password reset failed:", error.message);
  } finally {
    await mongoose.disconnect();
    rl.close();
  }
}

resetInstitutionPassword();
