const mongoose = require("mongoose");

const inventoryItemSchema = new mongoose.Schema(
  {
    inventoryCode: { type: String, required: true, unique: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    purchasePrice: { type: Number, default: 0 },
    additionalCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    purchaseDate: { type: Date, default: Date.now },
    supplier: { type: String, default: "" },
    location: {
      type: String,
      enum: ["WAREHOUSE", "OFFICE", "SALES_TEAM", "COURIER", "CUSTOMER"],
      default: "WAREHOUSE",
    },
    status: {
      type: String,
      enum: ["IN_STOCK", "RESERVED", "SOLD", "RETURNED", "DAMAGED", "LOST", "CANCELLED"],
      default: "IN_STOCK",
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    soldDate: { type: Date, default: null },
  },
  { timestamps: true }
);

// Movement log embedded for simplicity (Section 39)
const movementSchema = new mongoose.Schema(
  {
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    type: {
      type: String,
      enum: ["PURCHASE", "SALE", "RETURN", "DAMAGE", "ADJUSTMENT", "TRANSFER"],
      required: true,
    },
    quantity: { type: Number, default: -1 },
    referenceType: { type: String, default: "" },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = {
  InventoryItem: mongoose.model("InventoryItem", inventoryItemSchema),
  InventoryMovement: mongoose.model("InventoryMovement", movementSchema),
};
