const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    transactionNumber: { type: String, unique: true, sparse: true },
    transactionType: {
      type: String,
      enum: [
        "OWNER_DEPOSIT",
        "CUSTOMER_PAYMENT",
        "OTHER_INCOME",
        "REFUND_RECEIVED",
        "PRODUCT_PURCHASE",
        "EXPENSE",
        "CUSTOMER_REFUND",
        "WITHDRAWAL",
        "OTHER_PAYMENT",
      ],
      required: true,
    },
    direction: { type: String, enum: ["IN", "OUT"], required: true },
    amount: { type: Number, required: true },
    transactionDate: { type: Date, default: Date.now },
    depositorName: { type: String, default: "" }, // e.g. "Saikat", "Shovon" — who deposited/withdrew
    referenceType: { type: String, default: "" }, // e.g. "Order", "Expense"
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    description: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isDeleted: { type: Boolean, default: false }, // soft delete (Rule 10)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
