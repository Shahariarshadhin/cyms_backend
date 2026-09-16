const express = require("express");
const { InventoryItem, InventoryMovement } = require("../models/InventoryItem");
const Product = require("../models/Product");
const { protect } = require("../middleware/auth");
const { generateInventoryCode } = require("../utils/ids");

const router = express.Router();
router.use(protect);

async function syncProductQuantity(productId) {
  const count = await InventoryItem.countDocuments({ product: productId, status: "IN_STOCK" });
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
    res.json({ items, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// Add stock (create one or more inventory items for a product) — Rule: PURCHASE movement
router.post("/", async (req, res, next) => {
  try {
    const { productId, quantity = 1, purchasePrice, additionalCost, supplier, location, purchaseDate } = req.body;
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const created = [];
    for (let i = 0; i < Number(quantity); i++) {
      const inventoryCode = await generateInventoryCode();
      const pPrice = purchasePrice ?? product.purchasePrice;
      const aCost = additionalCost ?? product.additionalCost;
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
    await syncProductQuantity(product._id);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const item = await InventoryItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ message: "Inventory item not found" });
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
    if (!item) return res.status(404).json({ message: "Inventory item not found" });

    item.status = status;
    await item.save();

    const movementType = status === "DAMAGED" ? "DAMAGE" : status === "RETURNED" ? "RETURN" : "ADJUSTMENT";
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
    const movements = await InventoryMovement.find({ product: req.params.productId }).sort({ createdAt: -1 });
    res.json(movements);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
