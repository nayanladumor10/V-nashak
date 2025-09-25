const express = require("express");
let GoogleGenerativeAI;
try {
  ({ GoogleGenerativeAI } = require("@google/generative-ai"));
} catch (e) {
  console.warn("@google/generative-ai not installed. /analyze-file will fallback.");
}
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { spawn } = require("child_process");
const License = require("./models/License");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Add CORS headers for development
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`📨 Body:`, req.body);
  }
  next();
});

// Connect to MongoDB
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));
} else {
  console.log("📝 MongoDB not configured, using file-based storage");
}

// --- User ID Validation Logic ---
let usedUserIds = new Set();
const USED_IDS_FILE = path.join(__dirname, "used-user-ids.json");

let validUserIds = new Set();
const VALID_IDS_FILE = path.join(__dirname, "user_ids.json");

// Function to load user IDs from the external JSON file
function loadValidUserIds() {
  try {
    if (fs.existsSync(VALID_IDS_FILE)) {
      const data = fs.readFileSync(VALID_IDS_FILE, "utf8");
      const idsArray = JSON.parse(data);
      validUserIds = new Set(idsArray);
      console.log(`✅ Loaded ${validUserIds.size} valid User IDs from ${VALID_IDS_FILE}`);
    } else {
      console.error(`❌ CRITICAL: User ID file not found at ${VALID_IDS_FILE}`);
      fs.writeFileSync(VALID_IDS_FILE, "[]", "utf8");
    }
  } catch (error) {
    console.error(`❌ Error loading or parsing user IDs from ${VALID_IDS_FILE}:`, error);
  }
}

// Checks if a User ID is in the list of valid IDs
function isUserIdValid(userId) {
  return validUserIds.has(userId);
}

// Checks if a User ID has already been used
function isUserIdAlreadyUsed(userId) {
  return usedUserIds.has(userId);
}

// Adds a User ID to the used list and saves it to the file
function markUserIdAsUsed(userId) {
  usedUserIds.add(userId);
  const data = JSON.stringify(Array.from(usedUserIds), null, 2);
  fs.writeFileSync(USED_IDS_FILE, data, "utf8");
  console.log(`✅ Marked User ID '${userId}' as used.`);
}

// This new function checks both validity AND usage
function validateUserIdDirectAndUnused(userId) {
  if (!isUserIdValid(userId)) {
    return { valid: false, message: `User ID '${userId}' is not a valid ID.` };
  }
  if (isUserIdAlreadyUsed(userId)) {
    return { valid: false, message: `User ID '${userId}' has already been used.` };
  }
  return { valid: true };
}

// --- C++ Scanner Logic (for future use, currently simplified) ---
const scannerExe = process.platform === "win32" ? "scanner.exe" : "scanner";
const scannerPath = path.join(__dirname, "..", scannerExe);

console.log(`🔍 Scanner path: ${scannerPath}`);
console.log(`🔍 Scanner exists: ${fs.existsSync(scannerPath)}`);

function validateUserIdWithCppBackend(userId) {
  return new Promise((resolve) => {
    console.warn(`⚠️ C++ validation is currently simplified. Using direct validation.`);
    const validation = validateUserIdDirectAndUnused(userId);
    resolve(validation.valid);
  });
}

/**
 * Generates a unique 14-character license key by checking the database.
 */
async function generateUniqueLicenseKey() {
  const segment = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  let key;
  let keyExists = false;
  do {
    key = `${segment()}-${segment()}-${segment()}`;
    const existingLicense = await License.findOne({ licenseKey: key });
    keyExists = !!existingLicense;
  } while (keyExists);
  return key;
}

// --- API Endpoints ---

// Server status endpoint
app.get("/", (req, res) => {
  res.json({
    status: "SUCCESS",
    message: "V-Nashak License Server is running",
    timestamp: new Date().toISOString(),
    emailConfigured: !!process.env.EMAIL_USER,
  });
});

// Test endpoint for User ID validation
app.post("/test-userid", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ status: "ERROR", message: "userId is required" });
  }

  const validation = validateUserIdDirectAndUnused(userId);
  res.json({
    status: "SUCCESS",
    userId: userId,
    isValidAndUnused: validation.valid,
    message: validation.valid ? "User ID is valid and unused." : validation.message,
  });
});

// Endpoint to validate User ID and send license key
app.post("/send-license", async (req, res) => {
  console.log(`📧 /send-license endpoint called`);
  const { email, userId, name, phoneNumber } = req.body;

  if (!email || !userId || !name || !phoneNumber) {
    return res.status(400).json({ status: "ERROR", message: "All fields are required." });
  }

  const validation = validateUserIdDirectAndUnused(userId);
  if (!validation.valid) {
    console.log(`❌ User ID validation failed: ${validation.message}`);
    return res.status(400).json({ status: "ERROR", message: validation.message });
  }

  console.log(`✅ User ID '${userId}' is valid and unused.`);

  try {
    const newLicenseKey = await generateUniqueLicenseKey();

    const newLicense = new License({
      email,
      userId,
      name,
      phoneNumber,
      licenseKey: newLicenseKey,
      status: "ASSIGNED",
    });

    await newLicense.save();
    console.log(`✅ Saved new license for '${email}' to MongoDB.`);

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn(`⚠️ Email credentials not configured.`);
      markUserIdAsUsed(userId);
      return res.json({
        status: "SUCCESS",
        message: "User ID validated, but email is not configured on the server.",
        licenseKey: newLicenseKey,
      });
    }

    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    const mailOptions = {
      from: `"V-Nashak Security" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your V-Nashak License Key 🔐",
      html: `<p>Hello ${name},</p><p>Your User ID <strong>${userId}</strong> has been validated. Here is your license key:</p><h2 style="text-align:center;">${newLicenseKey}</h2>`,
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    
    markUserIdAsUsed(userId);
    
    res.json({ status: "SUCCESS", message: "User ID validated and license key sent to your email!" });

  } catch (error) {
    console.error("❌ Error during license creation or email sending:", error);
    res.status(500).json({ status: "ERROR", message: "An internal server error occurred." });
  }
});

// License activation endpoint
app.post("/activate-license", async (req, res) => {
  console.log(`🔐 /activate-license endpoint called`);
  const { email, licenseKey, machineId } = req.body;

  if (!email || !licenseKey || !machineId) {
    return res.status(400).json({
      status: "ERROR",
      message: "Email, licenseKey, and machineId are required.",
    });
  }

  console.log(`🔐 Activating license: Email=${email}, Key=${licenseKey}, MachineId=${machineId}`);

  try {
    const storedLicense = await License.findOne({ licenseKey: licenseKey });

    if (!storedLicense) {
      return res.json({ status: "ERROR", message: "Invalid license key." });
    }

    if (storedLicense.email !== email) {
      return res.json({ status: "ERROR", message: "This license key is not valid for this email address." });
    }

    if (storedLicense.status === "ACTIVATED") {
      if (storedLicense.machineId === machineId) {
        console.log(`✅ License already active for ${email} on ${machineId}`);
        return res.json({
          status: "ALREADY_ACTIVATED",
          message: "This license is already active on this device.",
        });
      } else {
        return res.json({
          status: "ERROR",
          message: "This license key is already activated on a different machine.",
        });
      }
    }

    storedLicense.machineId = machineId;
    storedLicense.status = "ACTIVATED";
    storedLicense.activatedAt = new Date();

    await storedLicense.save();

    console.log(`✅ License ${licenseKey} activated for ${email} on ${machineId}`);
    res.json({ status: "VALID", message: "License activated successfully." });
  } catch (dbError) {
    console.error("❌ Database error during activation:", dbError);
    res.status(500).json({ status: "ERROR", message: "A database error occurred during activation." });
  }
});

// AI analysis endpoint using Gemini (JSON-only response)
app.post("/analyze-file", async (req, res) => {
  try {
    const { fileContent, fileName } = req.body || {};
    if (!fileContent || !fileName) {
      return res.status(400).json({ error: "File content and name are required." });
    }

    // If library or key missing, do a safe fallback result
    if (!GoogleGenerativeAI || !process.env.GEMINI_API_KEY) {
      return res.status(200).json({
        is_malicious: false,
        confidence_score: 0.0,
        reason: "AI disabled or not configured",
        threat_type: "Benign",
      });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Respond ONLY with a minified JSON object. No backticks.
{
  "is_malicious": boolean,
  "confidence_score": number (0..1),
  "reason": string,
  "threat_type": string
}
Analyze the following file content for malicious behavior as a senior cybersecurity analyst.
The file is named "${fileName}".
Content:\n---\n${fileContent}\n---`;

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || "";
    const cleaned = (text || "").replace(/```json|```/g, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      // Normalize fields
      return res.status(200).json({
        is_malicious: !!parsed.is_malicious,
        confidence_score: Math.max(0, Math.min(1, Number(parsed.confidence_score) || 0)),
        reason: String(parsed.reason || ""),
        threat_type: String(parsed.threat_type || "Unknown"),
      });
    } catch (e) {
      console.warn("Gemini returned non-JSON, falling back.", cleaned);
      return res.status(200).json({
        is_malicious: false,
        confidence_score: 0.0,
        reason: "Non-JSON response from AI",
        threat_type: "Benign",
      });
    }
  } catch (error) {
    console.error("/analyze-file error:", error);
    return res.status(500).json({ error: "Failed to analyze file with AI." });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("❌ Server error:", error);
  res.status(500).json({
    status: "ERROR",
    message: "Internal server error",
    error: error.message,
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({
    status: "ERROR",
    message: `Route not found: ${req.method} ${req.url}`,
  });
});

// Start server and load initial data
app.listen(PORT, () => {
  if (fs.existsSync(USED_IDS_FILE)) {
    const data = fs.readFileSync(USED_IDS_FILE, "utf8");
    if (data) {
      try {
        usedUserIds = new Set(JSON.parse(data));
        console.log(`✅ Loaded ${usedUserIds.size} used User IDs.`);
      } catch (e) {
        console.error("Could not parse used-user-ids.json, starting fresh.");
        usedUserIds = new Set();
      }
    }
  }

  loadValidUserIds();

  console.log(`✅ V-Nashak License Server running on http://localhost:${PORT}`);
  console.log(`📧 Email configured: ${!!process.env.EMAIL_USER}`);
  console.log(`📧 Email user: ${process.env.EMAIL_USER || "Not configured"}`);
  console.log(`📝 Available endpoints:`);
  console.log(`   GET  / - Server status`);
  console.log(`   POST /send-license - Validate User ID and send license`);
  console.log(`   POST /activate-license - Activate license key`);
  console.log(`   POST /test-userid - Test User ID validation`);
});
