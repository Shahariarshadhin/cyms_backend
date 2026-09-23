const express = require("express");
const ResearchProduct = require("../models/ResearchProduct");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const q = {};
    if (status) q.status = status;
    if (search) q.productName = new RegExp(search, "i");

    const items = await ResearchProduct.find(q)
      .populate("createdBy", "name")
      .sort({ createdAt: -1 });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      productName,
      image,
      imagePublicId,
      marketPriceMin,
      marketPriceMax,
      sourceLink,
      notes,
    } = req.body;
    if (!productName)
      return res.status(400).json({ message: "Product name is required" });

    let item = await ResearchProduct.create({
      productName,
      image: image || "",
      imagePublicId: imagePublicId || "",
      marketPriceMin: Number(marketPriceMin) || 0,
      marketPriceMax: Number(marketPriceMax) || 0,
      sourceLink: sourceLink || "",
      notes: notes || "",
      createdBy: req.user._id,
    });
    item = await item.populate("createdBy", "name");
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const allowed = [
      "productName",
      "image",
      "imagePublicId",
      "marketPriceMin",
      "marketPriceMax",
      "sourceLink",
      "notes",
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const item = await ResearchProduct.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true },
    ).populate("createdBy", "name");
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// Mark as purchased — moves it from the Researching list to the Purchase Done list
router.post("/:id/purchase", async (req, res, next) => {
  try {
    const { purchasedPrice, purchasedDate } = req.body;
    const item = await ResearchProduct.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });

    item.status = "PURCHASED";
    item.purchasedPrice =
      purchasedPrice !== undefined && purchasedPrice !== ""
        ? Number(purchasedPrice)
        : null;
    item.purchasedDate = purchasedDate || new Date();
    await item.save();
    await item.populate("createdBy", "name");

    res.json(item);
  } catch (err) {
    next(err);
  }
});

// Move a purchased item back to the researching list (undo)
router.post("/:id/revert", async (req, res, next) => {
  try {
    const item = await ResearchProduct.findByIdAndUpdate(
      req.params.id,
      { status: "RESEARCHING", purchasedPrice: null, purchasedDate: null },
      { new: true },
    ).populate("createdBy", "name");
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await ResearchProduct.findByIdAndDelete(req.params.id);
    res.json({ message: "Item deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
