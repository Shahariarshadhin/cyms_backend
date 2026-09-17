const mongoose = require("mongoose");

const boostingCostSchema = new mongoose.Schema(
  {
    // Free-text so it can hold either a single date or a range like the
    // sheet does ("18/02/2025 - 23/02/2026"). Sorting/pagination uses
    // createdAt (entry order), matching how rows are appended in the sheet.
    date: { type: String, default: "" },
    month: { type: String, default: "" },
    amountUSD: { type: Number, default: 0, min: 0 },
    amountBDT: { type: Number, default: 0, min: 0 },
    productName: { type: String, required: true, trim: true },
    note: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

boostingCostSchema.index({ isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("BoostingCost", boostingCostSchema);
