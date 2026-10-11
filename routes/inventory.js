const express = require("express");
const { InventoryItem, InventoryMovement } = require("../models/InventoryItem");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");
const { generateInventoryCode } = require("../utils/ids");

const router = express.Router();
router.use(protect);

// Reasons a manual stock decrease can be attributed to. These map onto the
// same InventoryItem.status values already used elsewhere (adjust route,
// order cancellation, etc.) so reporting stays consistent.
const DECREASE_REASONS = ["DAMAGED", "LOST", "RETURNED", "CANCELLED"];

async function syncProductQuantity(productId) {
  const count = await InventoryItem.countDocuments({
    product: productId,
    status: "IN_STOCK",
  });
  await Product.findByIdAndUpdate(productId, { quantity: count });
}

router.get("/", async (req, res, next) => {
  try {
    const { search, status, product, page = 1, limit = 50 } = req.query;
    const q = {};
    if (status) q.status = status;
    if (product) q.product = product;
    if (search) q.inventoryCode = new RegExp(search, "i");

    const items = await InventoryItem.find(q)
      .populate("product", "modelName watchName sku image")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await InventoryItem.countDocuments(q);
    res.json({
      items,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// Add stock (create one or more inventory items for a product) — Rule: PURCHASE movement
router.post("/", async (req, res, next) => {
  try {
    const {
      productId,
      quantity = 1,
      purchasePrice,
      additionalCost,
      supplier,
      location,
      purchaseDate,
    } = req.body;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const created = [];
    let resolvedPurchasePrice, resolvedAdditionalCost;

    for (let i = 0; i < Number(quantity); i++) {
      const inventoryCode = await generateInventoryCode();
      const pPrice = purchasePrice ?? product.purchasePrice;
      const aCost = additionalCost ?? product.additionalCost;
      resolvedPurchasePrice = pPrice;   // same value every loop iteration — just
      resolvedAdditionalCost = aCost;   // capturing it once for use after the loop

      const item = await InventoryItem.create({
        inventoryCode,
        product: product._id,
        purchasePrice: pPrice,
        additionalCost: aCost,
        totalCost: Number(pPrice) + Number(aCost),
        supplier: supplier || "",
        location: location || "WAREHOUSE",
        purchaseDate: purchaseDate || Date.now(),
        status: "IN_STOCK",
      });
      await InventoryMovement.create({
        inventoryItem: item._id,
        product: product._id,
        type: "PURCHASE",
        quantity: 1,
        notes: "Stock added",
      });
      created.push(item);
    }

    // --- ADD THIS ---
    // Keep Product's default cost in sync with the MOST RECENT restock,
    // so the restock form's "Default: $X" placeholder always shows the
    // latest price, not a stale original value.
    await Product.findByIdAndUpdate(product._id, {
      purchasePrice: resolvedPurchasePrice,
      additionalCost: resolvedAdditionalCost,
    });
    // --- END ADD ---

    await syncProductQuantity(product._id);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// Decrease stock (bulk): pulls N of the oldest IN_STOCK items for a product
// and marks them with a reason (damage, loss, return, cancellation). This is
// the "decrease" counterpart to POST / (restock/"increase"), operating at the
// product level instead of one inventory item at a time.
router.post("/decrease", async (req, res, next) => {
  try {
    const {
      productId,
      quantity = 1,
      reason = "DAMAGED",
      notes = "",
    } = req.body;

    if (!productId)
      return res.status(400).json({ message: "productId is required" });

    const qty = Number(quantity);
    if (!qty || qty < 1) {
      return res.status(400).json({ message: "Quantity must be at least 1" });
    }
    if (!DECREASE_REASONS.includes(reason)) {
      return res.status(400).json({
        message: `Invalid reason. Must be one of: ${DECREASE_REASONS.join(
          ", "
        )}`,
      });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Oldest stock first (FIFO), matches typical inventory accounting.
    const available = await InventoryItem.find({
      product: productId,
      status: "IN_STOCK",
    })
      .sort({ createdAt: 1 })
      .limit(qty);

    if (available.length < qty) {
      return res.status(400).json({
        message: `Cannot reduce by ${qty}. Only ${available.length} unit(s) currently in stock.`,
      });
    }

    const movementType =
      reason === "DAMAGED"
        ? "DAMAGE"
        : reason === "RETURNED"
        ? "RETURN"
        : "ADJUSTMENT";

    for (const item of available) {
      item.status = reason;
      await item.save();
      await InventoryMovement.create({
        inventoryItem: item._id,
        product: productId,
        type: movementType,
        quantity: -1,
        notes: notes || `Stock reduced (${reason})`,
      });
    }

    await syncProductQuantity(productId);
    res.json({
      message: `Reduced stock by ${available.length} unit(s)`,
      affected: available.length,
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const item = await InventoryItem.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!item)
      return res.status(404).json({ message: "Inventory item not found" });
    await syncProductQuantity(item.product);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// Adjust status manually (damage, loss, return-to-stock, etc.) with movement log
router.post("/:id/adjust", async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const item = await InventoryItem.findById(req.params.id);
    if (!item)
      return res.status(404).json({ message: "Inventory item not found" });

    item.status = status;
    await item.save();

    const movementType =
      status === "DAMAGED"
        ? "DAMAGE"
        : status === "RETURNED"
        ? "RETURN"
        : "ADJUSTMENT";
    await InventoryMovement.create({
      inventoryItem: item._id,
      product: item.product,
      type: movementType,
      quantity: status === "IN_STOCK" ? 1 : -1,
      notes: notes || "",
    });

    await syncProductQuantity(item.product);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.get("/movements/:productId", async (req, res, next) => {
  try {
    const movements = await InventoryMovement.find({
      product: req.params.productId,
    }).sort({ createdAt: -1 });
    res.json(movements);
  } catch (err) {
    next(err);
  }
});

// GET /api/inventory/history/:productId
// Full purchase-cost history for a product: every restock batch, oldest -> newest,
// with how many units from that batch are still IN_STOCK vs already sold/removed.
router.get("/history/:productId", protect, async (req, res, next) => {
  try {
    const { productId } = req.params;

    const items = await InventoryItem.find({ product: productId })
      .sort({ purchaseDate: 1, createdAt: 1 })
      .select(
        "inventoryCode purchasePrice additionalCost totalCost purchaseDate supplier status"
      );

    if (!items.length) {
      return res.json({ product: productId, batches: [], latest: null });
    }

    // Group items that share the exact same price+date combo into one "batch" row,
    // since a single restock call creates several identical InventoryItems at once.
    const batchMap = new Map();
    for (const it of items) {
      const key = `${it.purchasePrice}_${it.additionalCost}_${new Date(
        it.purchaseDate
      ).toISOString()}`;
      if (!batchMap.has(key)) {
        batchMap.set(key, {
          purchasePrice: it.purchasePrice,
          additionalCost: it.additionalCost,
          totalCost: it.totalCost,
          purchaseDate: it.purchaseDate,
          supplier: it.supplier,
          quantityBought: 0,
          quantityInStock: 0,
          quantitySold: 0,
          quantityOther: 0, // damaged/lost/returned/cancelled
        });
      }
      const b = batchMap.get(key);
      b.quantityBought += 1;
      if (it.status === "IN_STOCK") b.quantityInStock += 1;
      else if (it.status === "SOLD") b.quantitySold += 1;
      else b.quantityOther += 1;
    }

    const batches = Array.from(batchMap.values()).sort(
      (a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate)
    );

    const latest = batches[batches.length - 1];
    const previous = batches.length > 1 ? batches[batches.length - 2] : null;

    res.json({
      product: productId,
      batches,       // full chronological list, oldest first
      latest,        // most recent restock batch
      previous,       // the one before it, if any
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
