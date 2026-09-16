const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    courier: { type: String, default: "" },
    trackingNumber: { type: String, default: "" },
    deliveryCharge: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["PENDING", "PACKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED"],
      default: "PENDING",
    },
    shippedDate: { type: Date, default: null },
    expectedDate: { type: Date, default: null },
    deliveredDate: { type: Date, default: null },
    returnDate: { type: Date, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Delivery", deliverySchema);
