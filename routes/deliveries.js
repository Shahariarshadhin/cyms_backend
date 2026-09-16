const express = require("express");
const Delivery = require("../models/Delivery");
const Order = require("../models/Order");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const { status, courier, page = 1, limit = 50 } = req.query;
    const q = {};
    if (status) q.status = status;
    if (courier) q.courier = new RegExp(courier, "i");
    const deliveries = await Delivery.find(q)
      .populate("customer", "name phone address")
      .populate("order", "orderNumber totalAmount")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Delivery.countDocuments(q);
    res.json({ deliveries, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const delivery = await Delivery.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!delivery) return res.status(404).json({ message: "Delivery not found" });

    // keep order.deliveryStatus in sync
    await Order.findByIdAndUpdate(delivery.order, { deliveryStatus: delivery.status });
    res.json(delivery);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
