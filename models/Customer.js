const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema(
  {
    customerCode: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    alternativePhone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    district: { type: String, default: "" },
    city: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Customer", customerSchema);
