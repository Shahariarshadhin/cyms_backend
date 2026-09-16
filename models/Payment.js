const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    paymentNumber: { type: String, unique: true, sparse: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    amount: { type: Number, required: true },
    method: {
      type: String,
      enum: ["CASH", "BKASH", "NAGAD", "BANK", "CARD", "OTHER"],
      default: "CASH",
    },
    paymentDate: { type: Date, default: Date.now },
    reference: { type: String, default: "" },
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
