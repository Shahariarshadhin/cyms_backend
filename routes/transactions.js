const express = require("express");
const Transaction = require("../models/Transaction");
const { protect, permit } = require("../middleware/auth");
const { generateTransactionNumber } = require("../utils/ids");

const router = express.Router();
router.use(protect);

const MONEY_IN_TYPES = [
  "OWNER_DEPOSIT",
  "CUSTOMER_PAYMENT",
  "OTHER_INCOME",
  "REFUND_RECEIVED",
];

router.get("/", async (req, res, next) => {
  try {
    const {
      type,
      direction,
      from,
      to,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    // Clamp so a crafted request can't force one huge, slow fetch.
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safePage = Math.max(Number(page) || 1, 1);

    // These filters only decide which rows are *displayed* — the running
    // balance below is always computed over the full non-deleted ledger,
    // otherwise "Balance" would reset to 0 at the top of a filtered view.
    const displayMatch = {};
    if (type) displayMatch.transactionType = type;
    if (direction) displayMatch.direction = direction;
    if (from || to) {
      displayMatch.transactionDate = {};
      if (from) displayMatch.transactionDate.$gte = new Date(from);
      if (to) displayMatch.transactionDate.$lte = new Date(to);
    }
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      displayMatch.$or = [
        { description: re },
        { depositorName: re },
        { transactionNumber: re },
      ];
    }

    // Base pipeline: full ledger, oldest first, with a cumulative running
    // balance attached to every document (requires MongoDB 5.0+).
    const basePipeline = [
      { $match: { isDeleted: false } },
      { $sort: { transactionDate: 1, _id: 1 } },
      {
        $setWindowFields: {
          sortBy: { transactionDate: 1, _id: 1 },
          output: {
            runningBalance: {
              $sum: {
                $cond: [
                  { $eq: ["$direction", "IN"] },
                  "$amount",
                  { $multiply: ["$amount", -1] },
                ],
              },
              window: { documents: ["unbounded", "current"] },
            },
          },
        },
      },
    ];

    const [transactions, countResult] = await Promise.all([
      Transaction.aggregate([
        ...basePipeline,
        { $match: displayMatch },
        { $sort: { transactionDate: -1, _id: -1 } },
        { $skip: (safePage - 1) * safeLimit },
        { $limit: safeLimit },
      ]),
      Transaction.aggregate([
        ...basePipeline,
        { $match: displayMatch },
        { $count: "count" },
      ]),
    ]);

    const total = countResult[0]?.count || 0;

    res.json({
      transactions,
      total,
      page: safePage,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    });
  } catch (err) {
    next(err);
  }
});

// Owner deposit / manual money in-out entry
router.post("/", permit("ADMIN", "ACCOUNTS"), async (req, res, next) => {
  try {
    const {
      transactionType,
      amount,
      transactionDate,
      description,
      depositorName,
    } = req.body;
    const direction = MONEY_IN_TYPES.includes(transactionType) ? "IN" : "OUT";

    const txn = await Transaction.create({
      transactionNumber: await generateTransactionNumber(),
      transactionType,
      direction,
      amount,
      transactionDate: transactionDate || Date.now(),
      description,
      depositorName: depositorName || "",
      createdBy: req.user._id,
    });
    res.status(201).json(txn);
  } catch (err) {
    next(err);
  }
});

// Edit a manually-entered transaction (deposit/withdrawal). Recomputes direction if type changes.
router.put("/:id", permit("ADMIN", "ACCOUNTS"), async (req, res, next) => {
  try {
    const {
      transactionType,
      amount,
      transactionDate,
      description,
      depositorName,
    } = req.body;
    const txn = await Transaction.findById(req.params.id);
    if (!txn || txn.isDeleted)
      return res.status(404).json({ message: "Transaction not found" });

    if (transactionType !== undefined) {
      txn.transactionType = transactionType;
      txn.direction = MONEY_IN_TYPES.includes(transactionType) ? "IN" : "OUT";
    }
    if (amount !== undefined) {
      if (amount <= 0)
        return res
          .status(400)
          .json({ message: "Amount must be greater than zero" });
      txn.amount = amount;
    }
    if (transactionDate !== undefined) txn.transactionDate = transactionDate;
    if (description !== undefined) txn.description = description;
    if (depositorName !== undefined) txn.depositorName = depositorName;

    await txn.save();
    res.json(txn);
  } catch (err) {
    next(err);
  }
});

// Soft delete a manually-entered transaction
router.delete("/:id", permit("ADMIN", "ACCOUNTS"), async (req, res, next) => {
  try {
    const txn = await Transaction.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true },
      { new: true }
    );
    if (!txn) return res.status(404).json({ message: "Transaction not found" });
    res.json({ message: "Transaction removed" });
  } catch (err) {
    next(err);
  }
});

router.get("/balance", async (req, res, next) => {
  try {
    const inAgg = await Transaction.aggregate([
      { $match: { direction: "IN", isDeleted: false } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const outAgg = await Transaction.aggregate([
      { $match: { direction: "OUT", isDeleted: false } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalIn = inAgg[0]?.total || 0;
    const totalOut = outAgg[0]?.total || 0;
    res.json({ totalIn, totalOut, balance: totalIn - totalOut });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
