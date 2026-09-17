const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: "Cozy Yards" },
    logo: { type: String, default: "" }, // Cloudinary URL
    logoPublicId: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    currency: { type: String, default: "BDT" },
    currencySymbol: { type: String, default: "৳" },
    timezone: { type: String, default: "Asia/Dhaka" },
    orderPrefix: { type: String, default: "CY" },
    productPrefix: { type: String, default: "PRD" },
    invoicePrefix: { type: String, default: "INV" },
    defaultDeliveryCharge: { type: Number, default: 0 },
    defaultTax: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Singleton pattern: always the same document
settingsSchema.statics.getSingleton = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model("Settings", settingsSchema);
