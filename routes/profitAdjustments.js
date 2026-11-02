const express = require("express");
const ProfitAdjustment = require("../models/ProfitAdjustment");
const Order = require("../models/Order");
const { protect, permit } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// List adjustments (optionally for one product and/or one order)
router.get("/", async (req, res, next) => {
  try {
    const { product, order } = req.query;
    const q = { isDeleted: false };
    if (product) q.product = product;
    if (order) q.order = order;
    const list = await ProfitAdjustment.find(q)
      .populate("createdBy", "name")
      .sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Add an adjustment. amount > 0 increases profit, amount < 0 decreases it.
router.post("/", permit("ADMIN", "ACCOUNTS"), async (req, res, next) => {
  try {
    const { orderId, productId, amount, reason } = req.body;

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      return res
        .status(400)
        .json({ message: "Amount must be a number other than zero" });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "A reason is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.status !== "DELIVERED") {
      return res
        .status(400)
        .json({ message: "Only delivered orders can be adjusted" });
    }
    const hasProduct = order.items.some(
      (i) => String(i.product) === String(productId),
    );
    if (!hasProduct) {
      return res
        .status(400)
        .json({ message: "This product is not part of that order" });
    }

    const adj = await ProfitAdjustment.create({
      product: productId,
      order: order._id,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate || order.createdAt,
      amount: amt,
      reason: String(reason).trim(),
      createdBy: req.user._id,
    });
    res.status(201).json(adj);
  } catch (err) {
    next(err);
  }
});

// Remove an adjustment (soft delete, so there is still a record of it)
router.delete("/:id", permit("ADMIN", "ACCOUNTS"), async (req, res, next) => {
  try {
    const adj = await ProfitAdjustment.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true, deletedBy: req.user._id },
      { new: true },
    );
    if (!adj) return res.status(404).json({ message: "Adjustment not found" });
    res.json({ message: "Adjustment removed" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;