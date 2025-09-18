const nodemailer = require("nodemailer");
require("dotenv").config();

const [,, email, licenseKey] = process.argv;

if (!email || !licenseKey) {
  console.error("Usage: node sendEmail.js <email> <licenseKey>");
  process.exit(1);
}

async function sendMail() {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const htmlContent = `
    <h2 style="color: #2563eb;">V-Nashak Security - License Key</h2>
    <p>Thank you for choosing V-Nashak Security!</p>
    <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
      <p><strong>Your License Key:</strong></p>
      <p style="font-size: 24px; font-weight: bold;">${licenseKey}</p>
    </div>
    <p>This key is tied to your email and machine.</p>
  `;

  const mailOptions = {
    from: `"V-Nashak Security" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your V-Nashak License Key",
    html: htmlContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Email sent");
    process.exit(0);
  } catch (error) {
    console.error("Failed to send email:", error);
    process.exit(1);
  }
}

sendMail();
