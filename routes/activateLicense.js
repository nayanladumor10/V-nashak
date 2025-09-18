const express = require("express")
const router = express.Router()
const License = require("../models/License")

// License activation endpoint
router.post("/", async (req, res) => {
  console.log(`🔐 /activate-license route called`)
  console.log(`🔐 Request body:`, req.body)

  const { email, licenseKey, userId, machineId } = req.body

  if (!email || !licenseKey) {
    console.log(`❌ Missing required fields: email or licenseKey`)
    return res.status(400).json({
      status: "ERROR",
      message: "Email and licenseKey are required.",
    })
  }

  // Generate machine ID if not provided (for web-based activation)
  const finalMachineId = machineId || `WEB-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

  console.log(`🔐 Processing activation: Email=${email}, Key=${licenseKey}, MachineId=${finalMachineId}`)

  try {
    // Check if license already exists
    const existingLicense = await License.findOne({
      $or: [{ email: email, licenseKey: licenseKey }, { licenseKey: licenseKey }],
    })

    if (existingLicense) {
      if (existingLicense.machineId === finalMachineId) {
        console.log(`✅ License already activated for this machine`)
        return res.json({
          status: "SUCCESS",
          message: "License is already active on this device.",
        })
      } else {
        console.log(`❌ License already activated on different machine`)
        return res.json({
          status: "ERROR",
          message: "This license key is already activated on a different machine.",
        })
      }
    }

    // Create new license activation
    const newLicense = new License({
      email: email,
      licenseKey: licenseKey,
      machineId: finalMachineId,
    })

    await newLicense.save()
    console.log(`✅ License activated successfully: ${licenseKey}`)

    return res.json({
      status: "SUCCESS",
      message: "License activated successfully.",
    })
  } catch (error) {
    console.error("❌ Error in activate-license route:", error)
    return res.status(500).json({
      status: "ERROR",
      message: `Database error: ${error.message}`,
    })
  }
})

module.exports = router
