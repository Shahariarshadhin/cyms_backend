const mongoose = require("mongoose");

const researchProductSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true },
    image: { type: String, default: "" }, // Cloudinary URL
    imagePublicId: { type: String, default: "" },
    marketPriceMin: { type: Number, default: 0 },
    marketPriceMax: { type: Number, default: 0 },
    sourceLink: { type: String, default: "" }, // where it was found, optional
    notes: { type: String, default: "" },

    status: { type: String, enum: ["RESEARCHING", "PURCHASED"], default: "RESEARCHING" },
    purchasedPrice: { type: Number, default: null },
    purchasedDate: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ResearchProduct", researchProductSchema);