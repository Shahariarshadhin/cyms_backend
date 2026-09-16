const Counter = require("../models/Counter");

// Generates sequential, human-friendly IDs like CY-2026-000001, PRD-00001, INV-000001
async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const seq = await nextSequence(`order_${year}`);
  return `CY-${year}-${String(seq).padStart(6, "0")}`;
}

async function generateProductSku() {
  const seq = await nextSequence("product");
  return `PRD-${String(seq).padStart(5, "0")}`;
}

async function generateInventoryCode() {
  const seq = await nextSequence("inventory");
  return `INV-${String(seq).padStart(6, "0")}`;
}

async function generateCustomerCode() {
  const seq = await nextSequence("customer");
  return `CUS-${String(seq).padStart(5, "0")}`;
}

async function generateExpenseNumber() {
  const seq = await nextSequence("expense");
  return `EXP-${String(seq).padStart(5, "0")}`;
}

async function generatePaymentNumber() {
  const seq = await nextSequence("payment");
  return `PAY-${String(seq).padStart(5, "0")}`;
}

async function generateTransactionNumber() {
  const seq = await nextSequence("transaction");
  return `TXN-${String(seq).padStart(6, "0")}`;
}

module.exports = {
  generateOrderNumber,
  generateProductSku,
  generateInventoryCode,
  generateCustomerCode,
  generateExpenseNumber,
  generatePaymentNumber,
  generateTransactionNumber,
};
