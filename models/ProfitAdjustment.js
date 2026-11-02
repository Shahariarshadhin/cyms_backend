const mongoose = require("mongoose");

// A manual correction to the profit of one product on one delivered order.
// The order itself is never modified: reports add `amount` on top of the
// profit snapshot stored on the order items.
const profitAdjustmentSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, default: "" }, // snapshot
    // Snapshot of the order's date, so date-range reports place the
    // adjustment in the same period as the sale it corrects.
    orderDate: { type: Date, required: true },
    // Positive = adds profit, negative = reduces profit.
    amount: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

profitAdjustmentSchema.index({ product: 1, order: 1, isDeleted: 1 });
profitAdjustmentSchema.index({ orderDate: 1, isDeleted: 1 });

module.exports = mongoose.model("ProfitAdjustment", profitAdjustmentSchema);