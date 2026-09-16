const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, unique: true, sparse: true },
    modelName: { type: String, required: true },
    watchName: { type: String, required: true },
    brand: { type: String, default: "" },
    category: { type: String, default: "General" },
    description: { type: String, default: "" },
    image: { type: String, default: "" }, // cloudinary URL
    imagePublicId: { type: String, default: "" },
    purchasePrice: { type: Number, required: true, default: 0 },
    additionalCost: { type: Number, default: 0 },
    estSellingMin: { type: Number, default: 0 },
    estSellingMax: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 }, // derived cache, kept in sync
    minimumStock: { type: Number, default: 2 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.virtual("totalCost").get(function () {
  return (this.purchasePrice || 0) + (this.additionalCost || 0);
});
productSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Product", productSchema);
