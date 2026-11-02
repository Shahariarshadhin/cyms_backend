require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("./models/Order");
const { InventoryItem } = require("./models/InventoryItem");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const order = await Order.findOne({ orderNumber: "CY-2026-000033" });
  if (!order) {
    console.log("Order not found");
    process.exit(1);
  }

  for (const it of order.items) {
    console.log("Before:", it.productName, "additionalCost =", it.additionalCost);
    it.additionalCost = 270;
    it.profit = it.unitPrice - it.costPrice - 270;
  }
  await order.save();

  await InventoryItem.updateMany(
    { _id: { $in: order.items.map((i) => i.inventoryItem) } },
    { $set: { additionalCost: 270, totalCost: 700 + 270 } },
  );

  console.log("Done. Order CY-2026-000031 updated.");
  process.exit(0);
})();