const mongoose = require("mongoose");

const licenseSchema = new mongoose.Schema({
  email: { type: String, required: true },
  licenseKey: { type: String, required: true },
  machineId: { type: String, required: false, default: null },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("License", licenseSchema);
