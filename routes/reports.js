const express = require("express");
const Order = require("../models/Order");
const { InventoryItem } = require("../models/InventoryItem");
const Product = require("../models/Product");
const Expense = require("../models/Expense");
const Customer = require("../models/Customer");
const Delivery = require("../models/Delivery");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

function dateRange(range, from, to) {
  const now = new Date();
  let start, end;
  end = new Date(now);
  switch (range) {
    case "today":
      start = new Date(now.setHours(0, 0, 0, 0));
      break;
    case "yesterday":
      start = new Date(now.setDate(now.getDate() - 1));
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    case "this_week": {
      const day = now.getDay();
      start = new Date(now.setDate(now.getDate() - day));
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "this_month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "last_month":
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    case "this_year":
      start = new Date(now.getFullYear(), 0, 1);
      break;
    case "custom":
      start = from ? new Date(from) : new Date(0);
      end = to ? new Date(to) : new Date();
      break;
    default:
      start = new Date(0);
  }
  return { start, end };
}

router.get("/sales", async (req, res, next) => {
  try {
    const { range = "this_month", from, to } = req.query;
    const { start, end } = dateRange(range, from, to);
    const orders = await Order.find({ orderDate: { $gte: start, $lte: end }, status: { $ne: "CANCELLED" } });

    const unitsSold = orders.reduce((s, o) => s + o.items.length, 0);
    const sales = orders.reduce((s, o) => s + o.subtotal, 0);
    const discount = orders.reduce((s, o) => s + o.discount, 0);
    const deliveryRevenue = orders.reduce((s, o) => s + o.deliveryCharge, 0);
    const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);

    res.json({ ordersCount: orders.length, unitsSold, sales, discount, deliveryRevenue, totalRevenue, orders });
  } catch (err) {
    next(err);
  }
});

router.get("/profit", async (req, res, next) => {
  try {
    const { range = "this_month", from, to } = req.query;
    const { start, end } = dateRange(range, from, to);
    const orders = await Order.find({ orderDate: { $gte: start, $lte: end }, status: { $ne: "CANCELLED" } });

    const sales = orders.reduce((s, o) => s + o.totalAmount, 0);
    const productCost = orders.reduce(
      (s, o) => s + o.items.reduce((si, it) => si + it.costPrice * it.quantity, 0),
      0
    );
    const additionalCost = orders.reduce(
      (s, o) => s + o.items.reduce((si, it) => si + it.additionalCost * it.quantity, 0),
      0
    );
    const grossProfit = sales - productCost - additionalCost;

    const expenses = await Expense.aggregate([
      { $match: { isDeleted: false, expenseDate: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const otherExpense = expenses[0]?.total || 0;
    const netProfit = grossProfit - otherExpense;

    res.json({ sales, productCost, additionalCost, grossProfit, otherExpense, netProfit });
  } catch (err) {
    next(err);
  }
});

router.get("/inventory", async (req, res, next) => {
  try {
    const current = await InventoryItem.find({ status: "IN_STOCK" }).populate("product", "modelName watchName sku");
    const sold = await InventoryItem.find({ status: "SOLD" })
      .populate("product", "modelName watchName")
      .populate("order", "orderNumber customer totalAmount");
    const lowStock = await Product.find({ isActive: true, $expr: { $lte: ["$quantity", "$minimumStock"] } });
    res.json({ current, sold, lowStock });
  } catch (err) {
    next(err);
  }
});

router.get("/expenses", async (req, res, next) => {
  try {
    const { range = "this_month", from, to } = req.query;
    const { start, end } = dateRange(range, from, to);
    const data = await Expense.aggregate([
      { $match: { isDeleted: false, expenseDate: { $gte: start, $lte: end } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);
    const grandTotal = data.reduce((s, d) => s + d.total, 0);
    res.json({ categories: data.map((d) => ({ category: d._id, amount: d.total })), grandTotal });
  } catch (err) {
    next(err);
  }
});

router.get("/customers", async (req, res, next) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const orders = await Order.find({ status: { $ne: "CANCELLED" } });
    const byCustomer = {};
    orders.forEach((o) => {
      const id = String(o.customer);
      byCustomer[id] = byCustomer[id] || { orders: 0, total: 0 };
      byCustomer[id].orders += 1;
      byCustomer[id].total += o.totalAmount;
    });
    const repeatCustomers = Object.values(byCustomer).filter((c) => c.orders > 1).length;
    const topEntries = Object.entries(byCustomer)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10);
    const topCustomerIds = topEntries.map(([id]) => id);
    const topCustomers = await Customer.find({ _id: { $in: topCustomerIds } });
    const topWithStats = topCustomers.map((c) => ({
      customer: c,
      ...byCustomer[String(c._id)],
    })).sort((a, b) => b.total - a.total);

    res.json({ totalCustomers, repeatCustomers, topCustomers: topWithStats });
  } catch (err) {
    next(err);
  }
});

router.get("/delivery", async (req, res, next) => {
  try {
    const data = await Delivery.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    res.json(data.map((d) => ({ status: d._id, count: d.count })));
  } catch (err) {
    next(err);
  }
});

// Per-product profit, delivered orders only
router.get("/product-profit", async (req, res, next) => {
  try {
    const { range = "this_month", from, to } = req.query;
    const { start, end } = dateRange(range, from, to);

    const products = await Order.aggregate([
      {
        $match: {
          status: "DELIVERED",
          orderDate: { $gte: start, $lte: end },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          productName: { $last: "$items.productName" },
          unitsSold: { $sum: "$items.quantity" },
          purchaseCost: {
            $sum: { $multiply: ["$items.costPrice", "$items.quantity"] },
          },
          otherCost: {
            $sum: { $multiply: ["$items.additionalCost", "$items.quantity"] },
          },
          sellingTotal: {
            $sum: { $multiply: ["$items.unitPrice", "$items.quantity"] },
          },
        },
      },
      {
        $addFields: {
          profit: {
            $subtract: [
              "$sellingTotal",
              { $add: ["$purchaseCost", "$otherCost"] },
            ],
          },
        },
      },
      { $sort: { profit: -1 } },
    ]);

    const totals = products.reduce(
      (t, p) => ({
        unitsSold: t.unitsSold + p.unitsSold,
        purchaseCost: t.purchaseCost + p.purchaseCost,
        otherCost: t.otherCost + p.otherCost,
        sellingTotal: t.sellingTotal + p.sellingTotal,
        profit: t.profit + p.profit,
      }),
      { unitsSold: 0, purchaseCost: 0, otherCost: 0, sellingTotal: 0, profit: 0 },
    );

    res.json({ products, totals });
  } catch (err) {
    next(err);
  }
});

// Every individual delivered sale of one product (for the expandable rows)
router.get("/product-profit/:productId", async (req, res, next) => {
  try {
    const { range = "this_month", from, to } = req.query;
    const { start, end } = dateRange(range, from, to);

    const orders = await Order.find({
      status: "DELIVERED",
      orderDate: { $gte: start, $lte: end },
      "items.product": req.params.productId,
    }).sort({ orderDate: -1 });

    const sales = [];
    for (const o of orders) {
      for (const it of o.items) {
        if (String(it.product) !== req.params.productId) continue;
        const qty = it.quantity || 1;
        sales.push({
          orderNumber: o.orderNumber,
          date: o.orderDate,
          purchasePrice: it.costPrice,
          otherCost: it.additionalCost,
          sellingPrice: it.unitPrice,
          quantity: qty,
          profit: (it.unitPrice - it.costPrice - it.additionalCost) * qty,
        });
      }
    }
    res.json(sales);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
