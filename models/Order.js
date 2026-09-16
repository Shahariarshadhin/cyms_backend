const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", default: null },
    productName: { type: String, default: "" }, // snapshot
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
    costPrice: { type: Number, default: 0 },
    additionalCost: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    orderDate: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: [
        "PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP",
        "SHIPPED", "DELIVERED", "CANCELLED", "RETURN_REQUESTED", "RETURNED",
      ],
      default: "PENDING",
    },
    items: [orderItemSchema],
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    deliveryCharge: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIAL", "PAID", "REFUNDED"],
      default: "UNPAID",
    },
    deliveryStatus: {
      type: String,
      enum: ["PENDING", "PACKED", "SHIPPED", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED"],
      default: "PENDING",
    },
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
