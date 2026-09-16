const express = require("express");
const Expense = require("../models/Expense");
const Transaction = require("../models/Transaction");
const { protect } = require("../middleware/auth");
const {
  generateExpenseNumber,
  generateTransactionNumber,
} = require("../utils/ids");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const { category, from, to, search, page = 1, limit = 50 } = req.query;
    // Clamp the page size so a crafted request can't force one huge, slow fetch.
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage = Math.max(Number(page) || 1, 1);

    // Rule 10 records are soft-deleted; never show them in the list or totals.
    const q = { isDeleted: { $ne: true } };
    if (category) q.category = category;
    if (from || to) {
      q.expenseDate = {};
      if (from) q.expenseDate.$gte = new Date(from);
      if (to) q.expenseDate.$lte = new Date(to);
    }
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ description: re }, { expenseNumber: re }];
    }

    const [expenses, total] = await Promise.all([
      Expense.find(q)
        .sort({ expenseDate: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      Expense.countDocuments(q),
    ]);

    // Summary figures intentionally ignore category/search/pagination so the
    // stat cards on the frontend always reflect the whole (non-deleted) dataset,
    // not just whatever page or filter is currently active.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [overallAgg, monthAgg, overallCount] = await Promise.all([
      Expense.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            isDeleted: { $ne: true },
            expenseDate: { $gte: monthStart, $lt: monthEnd },
          },
        },
        { $group: { _id: null, sum: { $sum: "$amount" } } },
      ]),
      Expense.countDocuments({ isDeleted: { $ne: true } }),
    ]);

    res.json({
      expenses,
      total,
      page: safePage,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
      summary: {
        overallTotal: overallAgg[0]?.sum || 0,
        thisMonthTotal: monthAgg[0]?.sum || 0,
        overallCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const body = req.body;
    body.expenseNumber = await generateExpenseNumber();
    body.createdBy = req.user._id;
    const expense = await Expense.create(body);

    await Transaction.create({
      transactionNumber: await generateTransactionNumber(),
      transactionType:
        expense.category === "PRODUCT_PURCHASE"
          ? "PRODUCT_PURCHASE"
          : "EXPENSE",
      direction: "OUT",
      amount: expense.amount,
      transactionDate: expense.expenseDate,
      referenceType: "Expense",
      referenceId: expense._id,
      description: expense.description || `Expense: ${expense.category}`,
      createdBy: req.user._id,
    });

    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!expense) return res.status(404).json({ message: "Expense not found" });
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    // Rule 10: soft delete financial records
    await Expense.findByIdAndUpdate(req.params.id, { isDeleted: true });
    res.json({ message: "Expense removed" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
