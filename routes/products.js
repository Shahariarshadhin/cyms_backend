const express = require("express");
const Product = require("../models/Product");
const { InventoryItem } = require("../models/InventoryItem");
const { protect } = require("../middleware/auth");
const { generateProductSku } = require("../utils/ids");
const { logAudit, diffFields } = require("../utils/audit");

const router = express.Router();
router.use(protect);

// Fields whose changes we record on update (quantity is derived, so it is not tracked here)
const TRACKED_FIELDS = [
  "sku",
  "modelName",
  "watchName",
  "brand",
  "category",
  "gender",
  "description",
  "purchasePrice",
  "additionalCost",
  "estSellingMin",
  "estSellingMax",
  "minimumStock",
  "image",
  "isActive",
];

// Things the client must never set directly
const PROTECTED_FIELDS = [
  "_id",
  "__v",
  "quantity",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
];

const labelOf = (p) => `${p.watchName}${p.sku ? ` (${p.sku})` : ""}`;

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
      .limit(Number(limit))
      .populate("createdBy updatedBy", "name");
    const total = await Product.countDocuments(q);

    res.json({
      products,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/low-stock", async (req, res, next) => {
  try {
    const products = await Product.find({
      isActive: true,
      $expr: { $lte: ["$quantity", "$minimumStock"] },
    });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      "createdBy updatedBy",
      "name",
    );
    if (!product) return res.status(404).json({ message: "Product not found" });
    const inventory = await InventoryItem.find({ product: product._id }).sort({
      createdAt: -1,
    });
    res.json({ product, inventory });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const body = { ...req.body };
    PROTECTED_FIELDS.forEach((f) => delete body[f]);
    if (!body.sku) body.sku = await generateProductSku();
    body.createdBy = req.user._id;
    body.updatedBy = req.user._id;

    const product = await Product.create(body);

    await logAudit(req, {
      action: "CREATE",
      entity: "PRODUCT",
      entityId: product._id,
      entityLabel: labelOf(product),
    });

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const before = await Product.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ message: "Product not found" });

    const body = { ...req.body };
    PROTECTED_FIELDS.forEach((f) => delete body[f]);
    body.updatedBy = req.user._id;

    const product = await Product.findByIdAndUpdate(req.params.id, body, {
      new: true,
    });

    const changes = diffFields(before, product.toObject(), TRACKED_FIELDS);
    if (changes.length > 0) {
      await logAudit(req, {
        action: "UPDATE",
        entity: "PRODUCT",
        entityId: product._id,
        entityLabel: labelOf(product),
        changes,
      });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const activeStock = await InventoryItem.countDocuments({
      product: req.params.id,
      status: { $in: ["IN_STOCK", "RESERVED"] },
    });

    if (activeStock > 0) {
      // Soft delete instead of hard delete if stock exists
      await Product.findByIdAndUpdate(req.params.id, {
        isActive: false,
        updatedBy: req.user._id,
      });
      await logAudit(req, {
        action: "DEACTIVATE",
        entity: "PRODUCT",
        entityId: product._id,
        entityLabel: labelOf(product),
        note: "Has active stock, so it was deactivated instead of deleted",
      });
      return res.json({ message: "Product deactivated (has active stock)" });
    }

    await Product.findByIdAndDelete(req.params.id);
    await logAudit(req, {
      action: "DELETE",
      entity: "PRODUCT",
      entityId: product._id,
      entityLabel: labelOf(product),
    });
    res.json({ message: "Product deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
