const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const Expense = require("../models/Expense");
const { protect } = require("../middleware/auth");
const { generateProductSku, generateCustomerCode, generateExpenseNumber } = require("../utils/ids");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
router.use(protect);

// Import products from Excel (Section 34: Model Name, Watch Name, Price->purchasePrice, Additional Cost)
router.post("/import/products", upload.single("file"), async (req, res, next) => {
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const results = { imported: 0, skipped: 0, errors: [] };
    for (const row of rows) {
      try {
        const modelName = row["Model Name"] || row["modelName"];
        const watchName = row["Watch Name"] || row["watchName"] || modelName;
        if (!modelName) { results.skipped++; continue; }

        const sku = await generateProductSku();
        await Product.create({
          sku,
          modelName,
          watchName,
          purchasePrice: Number(row["Price"] || row["purchasePrice"] || 0),
          additionalCost: Number(row["Additional Cost"] || row["additionalCost"] || 0),
          quantity: Number(row["Quantity"] || 0),
        });
        results.imported++;
      } catch (e) {
        results.errors.push(e.message);
      }
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.post("/import/customers", upload.single("file"), async (req, res, next) => {
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const results = { imported: 0, skipped: 0 };
    for (const row of rows) {
      const name = row["Customer Name"] || row["name"];
      const phone = row["C .Contact"] || row["Contact"] || row["phone"];
      if (!name || !phone) { results.skipped++; continue; }
      const customerCode = await generateCustomerCode();
      await Customer.create({
        customerCode,
        name,
        phone: String(phone),
        address: row["Customer Address"] || row["address"] || "",
      });
      results.imported++;
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.post("/import/expenses", upload.single("file"), async (req, res, next) => {
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const results = { imported: 0, skipped: 0 };
    for (const row of rows) {
      const amount = row["Expense Amount"] || row["amount"];
      if (!amount) { results.skipped++; continue; }
      const expenseNumber = await generateExpenseNumber();
      await Expense.create({
        expenseNumber,
        amount: Number(amount),
        description: row["Expense Description"] || "",
        expenseDate: row["Expense Date"] ? new Date(row["Expense Date"]) : new Date(),
        category: "OTHER",
      });
      results.imported++;
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// Generic export endpoint
router.get("/export/:type", async (req, res, next) => {
  try {
    const { type } = req.params;
    let rows = [];
    let filename = "export.xlsx";

    if (type === "products") {
      const products = await Product.find();
      rows = products.map((p) => ({
        SKU: p.sku, "Model Name": p.modelName, "Watch Name": p.watchName,
        Brand: p.brand, "Purchase Price": p.purchasePrice, "Additional Cost": p.additionalCost,
        Quantity: p.quantity, "Min Stock": p.minimumStock, Active: p.isActive,
      }));
      filename = "products.xlsx";
    } else if (type === "customers") {
      const customers = await Customer.find();
      rows = customers.map((c) => ({
        Code: c.customerCode, Name: c.name, Phone: c.phone, Address: c.address, District: c.district,
      }));
      filename = "customers.xlsx";
    } else if (type === "expenses") {
      const expenses = await Expense.find({ isDeleted: false });
      rows = expenses.map((e) => ({
        Number: e.expenseNumber, Category: e.category, Amount: e.amount,
        Date: e.expenseDate, Description: e.description,
      }));
      filename = "expenses.xlsx";
    } else {
      return res.status(400).json({ message: "Unknown export type" });
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
