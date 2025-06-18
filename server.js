require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const API_URL = "https://childguardbackend.vercel.app";

const app = express();
const PORT = process.env.PORT || 5000;
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { StreamChat } = require("stream-chat");

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cors());

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Schema for Report
const reportSchema = new mongoose.Schema({
  abuserName: String,
  abuserGender: String,
  abuserAge: String,
  relationship: String,
  natureOfAbuse: String,
  descriptionOfIncident: String,
  location: String,
  incidentLocation: String,
  reporterName: String,
  userId: String,
  reporterPhone: String,
  victimName: String,
  victimAge: String,
  victimGender: String,
  descriptionOfVictim: String,
  latitude: Number,
  longitude: Number,
  date: {
    type: Date,
    default: Date.now,
  },
  evidence: [
    {
      filename: String,
      base64: String,
    },
  ],
});

// Report Model
const Report = mongoose.model("Report", reportSchema);

// POST endpoint for submitting reports
app.post("/api/reports", async (req, res) => {
  try {
    const report = new Report(req.body);
    await report.save();
    res.status(201).json({ message: "Report submitted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to submit report", details: error.message });
  }
});

// User Model
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: { type: String, required: true },
    age: { type: String, required: true },
    gender: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    avatar: { type: String },
    status: { type: String, enum: ["pending", "approved"], default: "pending" },
    validId: { type: String },
    selfie: { type: String },
    resetCode: { type: String },
    resetCodeExpires: { type: Date },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", UserSchema);

// Signup Route
app.post("/signup", async (req, res) => {
  try {
    console.log("➡️ Signup request received:", req.body);

    const { name, email, password, phone, validId, selfie } = req.body;
    if (!name || !email || !password || !phone || !validId || !selfie) {
      console.warn("Missing email or password");
      return res.status(400).json({ error: "Missing email or password" });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.warn("User already exists:", email);
      return res.status(400).json({ error: "User already exists" });
    }

    // Check if phone exists
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      console.warn("User already exists:", phone);
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("Hashed Password:", hashedPassword);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone: phone,
      validId: validId,
      selfie: selfie,
    });
    await user.save();
    console.log("User created successfully:", user);

    res.status(201).json({ message: "Signup successful" });
  } catch (err) {
    console.error("Error during signup:", err);
    res
      .status(500)
      .json({ error: "Internal server error", details: err.message });
  }
});
// LOGIN ROUTE
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log("📩 Login request:", email);

    const user = await User.findOne({ email });
    if (!user) {
      console.warn("❌ No user found");
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("❌ Password mismatch");
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // 🛑 Check for 'pending' status before proceeding
    if (user.status === "pending") {
      return res
        .status(403)
        .json({ error: "Your account is pending approval" });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    console.log("🔑 JWT generated");

    const streamChat = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );

    // Optional: create user on Stream
    await streamChat.upsertUser({
      id: user._id.toString(),
      name: user.name,
    });

    const chatToken = streamChat.createToken(user._id.toString());

    console.log("✅ Chat token created");

    res.json({
      token,
      userId: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      chatToken,
    });
  } catch (err) {
    console.error("🔥 Login Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get User Profile
app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Error fetching user data" });
  }
});

// Update Avatar
app.post("/api/users/:id/avatar", async (req, res) => {
  try {
    const { avatar } = req.body;
    await User.findByIdAndUpdate(req.params.id, { avatar });
    res.json({ message: "Avatar updated" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update avatar" });
  }
});

// Backend endpoint example
app.post("/chat/token", async (req, res) => {
  const { userId } = req.body;
  const token = StreamChat.getInstance(
    process.env.STREAM_API_KEY,
    process.env.STREAM_API_SECRET
  ).createToken(userId);
  res.json({ token });
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Error fetching users" });
  }
});

app.get("/api/reports", async (req, res) => {
  try {
    const reports = await Report.find();
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: "Error fetching users" });
  }
});

// ARTICLE SCHEEMA
const articleSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    category: String,
    thumbnail: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

const Article = mongoose.model("Article", articleSchema);

app.get("/api/articles", async (req, res) => {
  try {
    const articles = await Article.find();
    res.json(articles);
  } catch (error) {
    res.status(500).json({ error: "Error fetching articles" });
  }
});

// SUBMIT VALID ID ROUTE
app.post("/submit-id", async (req, res) => {
  try {
    const { userId, base64Image } = req.body;
    await User.findByIdAndUpdate(userId, {
      validId: base64Image,
      status: "pending",
    });
    res.json({ message: "Valid ID submitted, awaiting approval" });
  } catch (err) {
    res.status(500).json({ error: "Error submitting ID" });
  }
});

// DELETE user from both MongoDB and Stream Chat
app.delete("/api/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    // Delete from MongoDB
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete from Stream Chat
    const streamChat = StreamChat.getInstance(
      process.env.STREAM_API_KEY,
      process.env.STREAM_API_SECRET
    );

    await streamChat.deleteUser(userId, { hard_delete: true });

    res.json({ message: "User deleted from MongoDB and Stream Chat" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Forgot Password
app.post("/request-reset", async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user)
    return res
      .status(404)
      .json({ success: false, message: "User not found with that email" });

  if (user.resetCodeExpires && user.resetCodeExpires > Date.now()) {
    return res.status(429).json({
      success: false,
      message: "Please wait before requesting a new code.",
    });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
  user.resetCode = code;
  user.resetCodeExpires = Date.now() + 10 * 60 * 1000; // 10 mins
  await user.save();

  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    to: email,
    from: process.env.EMAIL_USERNAME,
    subject: "Your ChildGuard Reset Code",
    html: `<h3>Your reset code is: <b>${code}</b></h3><p>It expires in 10 minutes.</p>`,
  };

  transporter.sendMail(mailOptions, (err) => {
    if (err) return res.status(500).json({ message: "Failed to send email" });
    res
      .status(200)
      .json({ success: true, message: "Reset code sent to email" });
  });
});

app.post("/verify-reset", async (req, res) => {
  const { email, code, password } = req.body;

  const user = await User.findOne({ email });

  if (!user || user.resetCode !== code || user.resetCodeExpires < Date.now()) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid or expired code" });
  }

  if (user.resetCodeExpires < Date.now())
    return res.status(400).json({ message: "Code expired" });

  user.password = await bcrypt.hash(password, 10);
  user.resetCode = undefined;
  user.resetCodeExpires = undefined;
  await user.save();

  res
    .status(200)
    .json({ success: true, message: "Password reset successfully" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
