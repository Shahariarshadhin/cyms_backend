const express = require("express");
const Customer = require("../models/Customer");
const Order = require("../models/Order");
const { protect } = require("../middleware/auth");
const { generateCustomerCode } = require("../utils/ids");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const q = {};
    if (search) {
      q.$or = [
        { name: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
        { address: new RegExp(search, "i") },
      ];
    }
    const customers = await Customer.find(q)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Customer.countDocuments(q);
    res.json({ customers, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    const orders = await Order.find({ customer: customer._id }).sort({ createdAt: -1 });
    const totalPurchase = orders
      .filter((o) => o.status !== "CANCELLED")
      .reduce((s, o) => s + (o.totalAmount || 0), 0);
    res.json({ customer, orders, totalOrders: orders.length, totalPurchase });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body.customerCode) body.customerCode = await generateCustomerCode();
    const customer = await Customer.create(body);
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const orderCount = await Order.countDocuments({ customer: req.params.id });
    if (orderCount > 0) return res.status(400).json({ message: "Cannot delete customer with existing orders" });
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ message: "Customer deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
