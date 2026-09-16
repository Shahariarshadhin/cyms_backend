const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    expenseNumber: { type: String, unique: true, sparse: true },
    category: {
      type: String,
      enum: [
        "WEBSITE", "SOFTWARE", "MARKETING", "MOBILE_Allowance", "TRAVEL_Allowance","BOOSTING_COST",
        "PRODUCT_RESEARCH", "COURIER", "PACKAGING", "PURCHASE_FOR_COMPANY",
        "SALARY", "SUBSCRIPTION", "PRODUCT_PURCHASE", "OTHER",
      ],
      default: "OTHER",
    },
    amount: { type: Number, required: true },
    expenseDate: { type: Date, default: Date.now },
    description: { type: String, default: "" },
    paymentMethod: {
      type: String,
      enum: ["CASH", "BKASH", "NAGAD", "BANK", "CARD", "OTHER"],
      default: "CASH",
    },
    reference: { type: String, default: "" },
    attachment: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Expense", expenseSchema);
