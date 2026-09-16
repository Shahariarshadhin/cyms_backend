const express = require("express");
const Product = require("../models/Product");
const { InventoryItem } = require("../models/InventoryItem");
const Order = require("../models/Order");
const Expense = require("../models/Expense");
const Transaction = require("../models/Transaction");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

router.get("/summary", async (req, res, next) => {
  try {
    const totalProducts = await Product.countDocuments({ isActive: true });
    const inStock = await InventoryItem.countDocuments({ status: "IN_STOCK" });
    const sold = await InventoryItem.countDocuments({ status: "SOLD" });

    const orders = await Order.find({ status: { $ne: "CANCELLED" } });
    const totalSales = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const totalProfit = orders.reduce(
      (s, o) => s + o.items.reduce((si, it) => si + (it.profit || 0) * (it.quantity || 1), 0),
      0
    );

    const expenseAgg = await Expense.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalExpense = expenseAgg[0]?.total || 0;

    const inAgg = await Transaction.aggregate([
      { $match: { direction: "IN", isDeleted: false } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const outAgg = await Transaction.aggregate([
      { $match: { direction: "OUT", isDeleted: false } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const currentBalance = (inAgg[0]?.total || 0) - (outAgg[0]?.total || 0);

    const pendingOrders = await Order.countDocuments({
      status: { $in: ["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED"] },
    });

    res.json({
      totalProducts,
      inStock,
      sold,
      totalSales,
      totalProfit,
      totalExpense,
      currentBalance,
      pendingOrders,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/sales-chart", async (req, res, next) => {
  try {
    const { period = "monthly" } = req.query;
    const groupFormat = period === "daily" ? "%Y-%m-%d" : period === "weekly" ? "%Y-W%U" : "%Y-%m";

    const data = await Order.aggregate([
      { $match: { status: { $ne: "CANCELLED" } } },
      {
        $group: {
          _id: { $dateToString: { format: groupFormat, date: "$orderDate" } },
          sales: { $sum: "$totalAmount" },
          profit: {
            $sum: {
              $reduce: {
                input: "$items",
                initialValue: 0,
                in: { $add: ["$$value", { $multiply: ["$$this.profit", "$$this.quantity"] }] },
              },
            },
          },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 24 },
    ]);
    res.json(data.map((d) => ({ period: d._id, sales: d.sales, profit: d.profit })));
  } catch (err) {
    next(err);
  }
});

router.get("/expense-chart", async (req, res, next) => {
  try {
    const data = await Expense.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);
    res.json(data.map((d) => ({ category: d._id, total: d.total })));
  } catch (err) {
    next(err);
  }
});

router.get("/inventory-chart", async (req, res, next) => {
  try {
    const data = await InventoryItem.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    res.json(data.map((d) => ({ status: d._id, count: d.count })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
