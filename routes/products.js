const express = require("express");
const Product = require("../models/Product");
const { InventoryItem } = require("../models/InventoryItem");
const { protect } = require("../middleware/auth");
const { generateProductSku } = require("../utils/ids");

const router = express.Router();
router.use(protect);

// List with search & filter
router.get("/", async (req, res, next) => {
  try {
    const { search, category, status, page = 1, limit = 50 } = req.query;
    const q = {};
    if (search) {
      q.$or = [
        { modelName: new RegExp(search, "i") },
        { watchName: new RegExp(search, "i") },
        { sku: new RegExp(search, "i") },
        { brand: new RegExp(search, "i") },
      ];
    }
    if (category) q.category = category;
    if (status === "active") q.isActive = true;
    if (status === "inactive") q.isActive = false;

    const products = await Product.find(q)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Product.countDocuments(q);

    res.json({ products, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

router.get("/low-stock", async (req, res, next) => {
  try {
    const products = await Product.find({ isActive: true, $expr: { $lte: ["$quantity", "$minimumStock"] } });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    const inventory = await InventoryItem.find({ product: product._id }).sort({ createdAt: -1 });
    res.json({ product, inventory });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body.sku) body.sku = await generateProductSku();
    const product = await Product.create(body);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const activeStock = await InventoryItem.countDocuments({
      product: req.params.id,
      status: { $in: ["IN_STOCK", "RESERVED"] },
    });
    if (activeStock > 0) {
      // Soft delete instead of hard delete if stock exists
      await Product.findByIdAndUpdate(req.params.id, { isActive: false });
      return res.json({ message: "Product deactivated (has active stock)" });
    }
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Product deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
