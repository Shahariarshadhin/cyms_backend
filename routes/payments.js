const express = require("express");
const Payment = require("../models/Payment");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const { protect } = require("../middleware/auth");
const { generatePaymentNumber, generateTransactionNumber } = require("../utils/ids");

const router = express.Router();
router.use(protect);

function computePaymentStatus(total, paid) {
  if (paid <= 0) return "UNPAID";
  if (paid >= total) return "PAID";
  return "PARTIAL";
}

router.get("/", async (req, res, next) => {
  try {
    const { order, customer, page = 1, limit = 50 } = req.query;
    const q = {};
    if (order) q.order = order;
    if (customer) q.customer = customer;
    const payments = await Payment.find(q)
      .populate("customer", "name phone")
      .populate("order", "orderNumber")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Payment.countDocuments(q);
    res.json({ payments, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// Record payment (Rule 5: cannot exceed due unless overpayment explicitly allowed)
router.post("/", async (req, res, next) => {
  try {
    const { order: orderId, amount, method, paymentDate, reference, notes, allowOverpayment } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (amount <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
    if (!allowOverpayment && amount > order.dueAmount) {
      return res.status(400).json({ message: `Amount exceeds due amount of ৳${order.dueAmount}` });
    }

    const paymentNumber = await generatePaymentNumber();
    const payment = await Payment.create({
      paymentNumber,
      order: order._id,
      customer: order.customer,
      amount,
      method: method || "CASH",
      paymentDate: paymentDate || Date.now(),
      reference,
      notes,
      createdBy: req.user._id,
    });

    order.paidAmount += Number(amount);
    order.dueAmount = order.totalAmount - order.paidAmount;
    order.paymentStatus = computePaymentStatus(order.totalAmount, order.paidAmount);
    if (order.status === "PENDING") order.status = "CONFIRMED";
    await order.save();

    await Transaction.create({
      transactionNumber: await generateTransactionNumber(),
      transactionType: "CUSTOMER_PAYMENT",
      direction: "IN",
      amount,
      transactionDate: paymentDate || Date.now(),
      referenceType: "Order",
      referenceId: order._id,
      description: `Payment for order ${order.orderNumber}`,
      createdBy: req.user._id,
    });

    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
