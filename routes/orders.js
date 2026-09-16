const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { InventoryItem, InventoryMovement } = require("../models/InventoryItem");
const Delivery = require("../models/Delivery");
const { protect } = require("../middleware/auth");
const { generateOrderNumber } = require("../utils/ids");

const router = express.Router();
router.use(protect);

function computePaymentStatus(total, paid) {
  if (paid <= 0) return "UNPAID";
  if (paid >= total) return "PAID";
  return "PARTIAL";
}

router.get("/", async (req, res, next) => {
  try {
    const { search, status, paymentStatus, deliveryStatus, page = 1, limit = 50 } = req.query;
    const q = {};
    if (status) q.status = status;
    if (paymentStatus) q.paymentStatus = paymentStatus;
    if (deliveryStatus) q.deliveryStatus = deliveryStatus;
    if (search) q.orderNumber = new RegExp(search, "i");

    const orders = await Order.find(q)
      .populate("customer", "name phone address")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Order.countDocuments(q);
    res.json({ orders, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

router.get("/recent", async (req, res, next) => {
  try {
    const orders = await Order.find().populate("customer", "name").sort({ createdAt: -1 }).limit(10);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer")
      .populate("items.product", "modelName watchName image sku")
      .populate("items.inventoryItem", "inventoryCode");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const delivery = await Delivery.findOne({ order: order._id });
    res.json({ order, delivery });
  } catch (err) {
    next(err);
  }
});

// Create order: reserves inventory items (Rule 1, 2, 4)
router.post("/", async (req, res, next) => {
  try {
    const { customer, items, discount = 0, deliveryCharge = 0, notes = "" } = req.body;
    if (!customer || !items || !items.length) {
      return res.status(400).json({ message: "Customer and at least one item are required" });
    }

    const orderItems = [];
    let subtotal = 0;

    for (const it of items) {
      if (it.quantity < 1) return res.status(400).json({ message: "Quantity must be at least 1" });
      const product = await Product.findById(it.product);
      if (!product) return res.status(404).json({ message: `Product not found: ${it.product}` });

      // Reserve available IN_STOCK inventory items for this product
      const available = await InventoryItem.find({ product: product._id, status: "IN_STOCK" }).limit(it.quantity);
      if (available.length < it.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.watchName}. Available: ${available.length}, requested: ${it.quantity}`,
        });
      }

      const unitPrice = it.unitPrice ?? product.estSellingMin ?? product.purchasePrice;
      const costPrice = product.purchasePrice;
      const additionalCost = product.additionalCost;
      const profitEach = unitPrice - costPrice - additionalCost;

      for (const invItem of available) {
        invItem.status = "RESERVED";
        await invItem.save();
        await InventoryMovement.create({
          inventoryItem: invItem._id,
          product: product._id,
          type: "SALE",
          quantity: -1,
          notes: "Reserved for order",
        });
        orderItems.push({
          product: product._id,
          inventoryItem: invItem._id,
          productName: product.watchName,
          quantity: 1,
          unitPrice,
          costPrice,
          additionalCost,
          profit: profitEach,
        });
      }
      subtotal += unitPrice * it.quantity;

      const count = await InventoryItem.countDocuments({ product: product._id, status: "IN_STOCK" });
      await Product.findByIdAndUpdate(product._id, { quantity: count });
    }

    const totalAmount = subtotal - Number(discount) + Number(deliveryCharge);
    const orderNumber = await generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      customer,
      items: orderItems,
      subtotal,
      discount,
      deliveryCharge,
      totalAmount,
      paidAmount: 0,
      dueAmount: totalAmount,
      paymentStatus: "UNPAID",
      status: "PENDING",
      deliveryStatus: "PENDING",
      notes,
      createdBy: req.user._id,
    });

    // link inventory items to this order
    await InventoryItem.updateMany(
      { _id: { $in: orderItems.map((o) => o.inventoryItem) } },
      { $set: { order: order._id } }
    );

    await Delivery.create({ order: order._id, customer, deliveryCharge, status: "PENDING" });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const { discount, deliveryCharge, notes, status } = req.body;
    if (discount !== undefined) order.discount = discount;
    if (deliveryCharge !== undefined) order.deliveryCharge = deliveryCharge;
    if (notes !== undefined) order.notes = notes;

    order.totalAmount = order.subtotal - order.discount + order.deliveryCharge;
    order.dueAmount = order.totalAmount - order.paidAmount;
    order.paymentStatus = computePaymentStatus(order.totalAmount, order.paidAmount);

    if (status) {
      order.status = status;
      // Rule 6: cancelled orders release reserved inventory back to stock
      if (status === "CANCELLED") {
        const invIds = order.items.map((i) => i.inventoryItem).filter(Boolean);
        await InventoryItem.updateMany(
          { _id: { $in: invIds }, status: { $ne: "SOLD" } },
          { $set: { status: "IN_STOCK", order: null } }
        );
        for (const it of order.items) {
          const count = await InventoryItem.countDocuments({ product: it.product, status: "IN_STOCK" });
          await Product.findByIdAndUpdate(it.product, { quantity: count });
        }
      }
      if (status === "DELIVERED") {
        const invIds = order.items.map((i) => i.inventoryItem).filter(Boolean);
        await InventoryItem.updateMany(
          { _id: { $in: invIds } },
          { $set: { status: "SOLD", soldDate: new Date() } }
        );
        order.deliveryStatus = "DELIVERED";
        await Delivery.findOneAndUpdate(
          { order: order._id },
          { status: "DELIVERED", deliveredDate: new Date() }
        );
      }
    }

    await order.save();
    res.json(order);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
