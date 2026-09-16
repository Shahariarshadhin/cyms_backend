const express = require("express");
const multer = require("multer");
const { storage, cloudinary } = require("../config/cloudinary");
const { protect } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage });

router.post("/image", protect, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });
  res.json({ url: req.file.path, publicId: req.file.filename });
});

router.delete("/image/:publicId", protect, async (req, res, next) => {
  try {
    await cloudinary.uploader.destroy(req.params.publicId);
    res.json({ message: "Image deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
