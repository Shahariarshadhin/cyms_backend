const express = require("express");
const BoostingCost = require("../models/BoostingCost");
const Expense = require("../models/Expense");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const { search, month, page = 1, limit = 10 } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 500);
    const safePage = Math.max(Number(page) || 1, 1);

    const q = { isDeleted: false };
    if (month) q.month = month;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [{ productName: re }, { note: re }, { date: re }];
    }

    const [items, total] = await Promise.all([
      BoostingCost.find(q)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      BoostingCost.countDocuments(q),
    ]);

    // Summary always reflects the whole (non-deleted) dataset, not the
    // current filter/page — same pattern as the expenses/finance pages.
    const [usedAgg, endorsedAgg] = await Promise.all([
      BoostingCost.aggregate([
        { $match: { isDeleted: false } },
        {
          $group: {
            _id: null,
            usedUSD: { $sum: "$amountUSD" },
            usedBDT: { $sum: "$amountBDT" },
            count: { $sum: 1 },
          },
        },
      ]),
      // The single source of truth for "money endorsed for boosting" is the
      // Expense collection, category BOOSTING_COST — not anything entered here.
      // Uses $ne: true (not isDeleted: false) because older Expense documents
      // predate the isDeleted field and don't have it set at all.
      Expense.aggregate([
        { $match: { isDeleted: { $ne: true }, category: "BOOSTING_COST" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const usedBDT = usedAgg[0]?.usedBDT || 0;
    const usedUSD = usedAgg[0]?.usedUSD || 0;
    const endorsedBDT = endorsedAgg[0]?.total || 0;

    res.json({
      items,
      total,
      page: safePage,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
      summary: {
        endorsedBDT,
        usedBDT,
        usedUSD,
        remainingBDT: endorsedBDT - usedBDT,
        count: usedAgg[0]?.count || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { date, month, amountUSD, amountBDT, productName, note } = req.body;
    if (!productName || !productName.trim()) {
      return res.status(400).json({ message: "Product name is required" });
    }
    const entry = await BoostingCost.create({
      date: date || "",
      month: month || "",
      amountUSD: Number(amountUSD) || 0,
      amountBDT: Number(amountBDT) || 0,
      productName: productName.trim(),
      note: note || "",
      createdBy: req.user._id,
    });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const existing = await BoostingCost.findById(req.params.id);
    if (!existing || existing.isDeleted) {
      return res.status(404).json({ message: "Boosting cost entry not found" });
    }
    const allowed = [
      "date",
      "month",
      "amountUSD",
      "amountBDT",
      "productName",
      "note",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) existing[key] = req.body[key];
    }
    if (!existing.productName || !existing.productName.trim()) {
      return res.status(400).json({ message: "Product name is required" });
    }
    await existing.save();
    res.json(existing);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const entry = await BoostingCost.findByIdAndUpdate(req.params.id, {
      isDeleted: true,
    });
    if (!entry)
      return res.status(404).json({ message: "Boosting cost entry not found" });
    res.json({ message: "Boosting cost entry removed" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
