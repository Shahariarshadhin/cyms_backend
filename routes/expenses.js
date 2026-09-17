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
    const { category, search, from, to, page = 1, limit = 50 } = req.query;
    const q = { isDeleted: false };
    if (category) q.category = category;
    if (from || to) {
      q.expenseDate = {};
      if (from) q.expenseDate.$gte = new Date(from);
      if (to) q.expenseDate.$lte = new Date(to);
    }
    if (search) {
      q.$or = [
        { description: new RegExp(search, "i") },
        { expenseNumber: new RegExp(search, "i") },
      ];
    }

    const expenses = await Expense.find(q)
      .sort({ expenseDate: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Expense.countDocuments(q);

    // Summary always reflects the whole dataset (not the current filter/page)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [overallAgg, monthAgg, overallCount] = await Promise.all([
      Expense.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Expense.aggregate([
        { $match: { isDeleted: false, expenseDate: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Expense.countDocuments({ isDeleted: false }),
    ]);

    res.json({
      expenses,
      total,
      page: Number(page),
      pages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        overallTotal: overallAgg[0]?.total || 0,
        thisMonthTotal: monthAgg[0]?.total || 0,
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

// Edit an expense — every field, including category. Keeps the linked
// ledger Transaction (created when the expense was first recorded) in sync
// so the Finance balance and reports stay accurate.
router.put("/:id", async (req, res, next) => {
  try {
    const existing = await Expense.findById(req.params.id);
    if (!existing || existing.isDeleted)
      return res.status(404).json({ message: "Expense not found" });

    const allowed = [
      "category",
      "amount",
      "expenseDate",
      "description",
      "paymentMethod",
      "reference",
      "attachment",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) existing[key] = req.body[key];
    }
    if (existing.amount < 0)
      return res.status(400).json({ message: "Amount cannot be negative" });

    await existing.save();

    await Transaction.findOneAndUpdate(
      { referenceType: "Expense", referenceId: existing._id },
      {
        transactionType:
          existing.category === "PRODUCT_PURCHASE"
            ? "PRODUCT_PURCHASE"
            : "EXPENSE",
        amount: existing.amount,
        transactionDate: existing.expenseDate,
        description: existing.description || `Expense: ${existing.category}`,
      }
    );

    res.json(existing);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    // Rule 10: soft delete financial records
    await Expense.findByIdAndUpdate(req.params.id, { isDeleted: true });
    await Transaction.findOneAndUpdate(
      { referenceType: "Expense", referenceId: req.params.id },
      { isDeleted: true }
    );
    res.json({ message: "Expense removed" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
