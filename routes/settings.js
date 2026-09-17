const express = require("express");
const Settings = require("../models/Settings");
const { protect, permit } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// Any logged-in user can read settings (needed for currency symbol, prefixes, etc.)
router.get("/", async (req, res, next) => {
  try {
    const settings = await Settings.getSingleton();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// Only Admin / Super Admin can change settings
router.put("/", permit("ADMIN"), async (req, res, next) => {
  try {
    const settings = await Settings.getSingleton();
    const allowed = [
      "companyName",
      "logo",
      "logoPublicId",
      "phone",
      "email",
      "address",
      "currency",
      "currencySymbol",
      "timezone",
      "orderPrefix",
      "productPrefix",
      "invoicePrefix",
      "defaultDeliveryCharge",
      "defaultTax",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) settings[key] = req.body[key];
    }
    await settings.save();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
