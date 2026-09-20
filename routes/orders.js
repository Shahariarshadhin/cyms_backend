const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { InventoryItem, InventoryMovement } = require("../models/InventoryItem");
const Delivery = require("../models/Delivery");
const { protect } = require("../middleware/auth");
const { generateOrderNumber } = require("../utils/ids");

const router = express.Router();
router.use(protect);

// Path to the logo used as the faint centered background watermark on
// invoices. Lives at public/assets/Cozy-Yards.png in this project.
const LOGO_PATH = path.join(__dirname, "../public/assets/Cozy-Yards.png");

function computePaymentStatus(total, paid) {
  if (paid <= 0) return "UNPAID";
  if (paid >= total) return "PAID";
  return "PARTIAL";
}

function money(n) {
  return `Tk ${Number(n || 0).toLocaleString("en-BD", {
    maximumFractionDigits: 2,
  })}`;
}

// Draws the company logo, faint and centered, behind everything else on the
// current page. Call this right after creating the doc and again after every
// doc.addPage() so multi-page invoices stay watermarked throughout.
function drawWatermark(doc) {
  const { width, height } = doc.page;
  const wmWidth = 260;
  doc.save();
  try {
    doc.opacity(0.06);
    doc.image(LOGO_PATH, (width - wmWidth) / 2, (height - wmWidth) / 2, {
      width: wmWidth,
    });
  } catch (err) {
    // Logo file missing or unreadable — skip the watermark rather than
    // failing the whole invoice.
    console.warn("Invoice watermark skipped:", err.message);
  } finally {
    // Always restore, whether the image drew successfully or threw —
    // otherwise a missing/bad image file leaves the rest of the PDF
    // stuck at 6% opacity.
    doc.restore();
  }
}

// Runs `fn` with fill/stroke opacity set to `alpha`, always resetting
// afterwards (even if `fn` throws) so one bad draw call can't leave the
// rest of the page faded — same pattern that fixed the watermark bug.
function withAlpha(doc, alpha, fn) {
  doc.save();
  try {
    doc.fillOpacity(alpha).strokeOpacity(alpha);
    fn();
  } finally {
    doc.restore();
  }
}

// A white rounded card with a soft drop shadow behind it — the base unit
// the invoice's "panels" (info block, totals block) are built from.
function drawCard(doc, x, y, w, h, radius = 10) {
  withAlpha(doc, 0.08, () => {
    doc.roundedRect(x + 3, y + 4, w, h, radius).fill("#000000");
  });
  doc.roundedRect(x, y, w, h, radius).fill("#ffffff");
  doc
    .roundedRect(x, y, w, h, radius)
    .lineWidth(0.75)
    .strokeColor("#e2e8f0")
    .stroke();
}

router.get("/", async (req, res, next) => {
  try {
    const {
      search,
      status,
      paymentStatus,
      deliveryStatus,
      page = 1,
      limit = 50,
    } = req.query;
    const q = {};
    if (status) q.status = status;
    if (paymentStatus) q.paymentStatus = paymentStatus;
    if (deliveryStatus) q.deliveryStatus = deliveryStatus;
    if (search) q.orderNumber = new RegExp(search, "i");

    const orders = await Order.find(q)
      .populate("customer", "name phone address")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Order.countDocuments(q);
    res.json({
      orders,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/recent", async (req, res, next) => {
  try {
    const orders = await Order.find()
      .populate("customer", "name")
      .sort({ createdAt: -1 })
      .limit(10);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customer")
      .populate("items.product", "modelName watchName image sku")
      .populate("items.inventoryItem", "inventoryCode");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const delivery = await Delivery.findOne({ order: order._id });
    res.json({ order, delivery });
  } catch (err) {
    next(err);
  }
});

// Invoice PDF for an order, downloadable/sendable to the customer.
// The customer's customerCode is shown as a "Coupon Code" on the invoice,
// per how this shop wants it presented — but only when explicitly asked
// for via ?showCoupon=true. It's off by default, since most invoices
// shouldn't carry it.
router.get("/:id/invoice", async (req, res, next) => {
  try {
    const includeCoupon = req.query.showCoupon === "true";

    const order = await Order.findById(req.params.id)
      .populate("customer")
      .populate("items.product", "modelName watchName sku")
      .populate("items.inventoryItem", "inventoryCode");
    if (!order) return res.status(404).json({ message: "Order not found" });

    const c = order.customer || {};

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice-${order.orderNumber}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 0 });
    doc.pipe(res);

    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const BRAND = "#197640"; // Cozy Yards green — swap this one value to re-theme the whole invoice
    const BRAND_DARK = "#0f4d29";
    const BRAND_LIGHT = "#e8f5ec";
    const INK = "#0f172a";
    const MUTED = "#64748b";
    const LINE = "#e2e8f0";
    const CX = 40; // left/right content margin
    const CW = PAGE_W - CX * 2;

    const STATUS_COLORS = {
      PAID: { bg: "#dcfce7", text: "#166534", dot: "#16a34a" },
      PARTIAL: { bg: "#fef3c7", text: "#92400e", dot: "#d97706" },
      UNPAID: { bg: "#fee2e2", text: "#991b1b", dot: "#dc2626" },
    };
    const statusColor =
      STATUS_COLORS[order.paymentStatus] || STATUS_COLORS.UNPAID;

    // Background watermark, drawn first so everything else sits on top.
    drawWatermark(doc);

    // ---- Header: diagonal brand banner with translucent circle accents ----
    const bandPts = [
      [0, 0],
      [370, 0],
      [270, 150],
      [0, 150],
    ];
    doc.save();
    doc.polygon(...bandPts).fill(BRAND);
    doc.restore();
    doc.save();
    doc.polygon(...bandPts).clip();
    withAlpha(doc, 0.08, () => {
      doc.circle(330, 10, 75).fill("#ffffff");
      doc.circle(90, 145, 45).fill("#ffffff");
    });
    doc.restore();

    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(30)
      .text("INVOICE", CX, 55);
    doc.rect(CX + 2, 96, 46, 3).fill("#ffffff");

    // ---- Logo + tagline, top right ----
    const LOGO_W = 100;
    try {
      doc.image(LOGO_PATH, PAGE_W - CX - LOGO_W, 28, { width: LOGO_W });
    } catch (err) {
      // Logo file missing — fall back to plain text so the invoice still
      // renders instead of throwing.
      doc
        .fillColor(BRAND)
        .font("Helvetica-Bold")
        .fontSize(16)
        .text("COZY YARDS", PAGE_W - CX - 200, 40, {
          width: 200,
          align: "right",
        });
    }
    // Tagline as a small rounded chip right under the logo — a plain gray
    // letter-spaced line read as an afterthought next to the logo mark, so
    // this gives it its own bit of visual weight instead.
    const tagline = "QUALITY AT YOUR DOORSTEP";
    doc.font("Helvetica-Bold").fontSize(7.5);
    const tagTextW = doc.widthOfString(tagline, { characterSpacing: 1 });
    const dotR = 2.5;
    const padX = 12;
    const gap = 6;
    const tagW = padX * 2 + dotR * 2 + gap + tagTextW;
    const tagX = PAGE_W - CX - tagW;
    const tagY = 102;
    doc.roundedRect(tagX, tagY, tagW, 18, 9).fill(BRAND_LIGHT);
    doc.circle(tagX + padX + dotR, tagY + 9, dotR).fill(BRAND);
    doc
      .fillColor(BRAND_DARK)
      .text(tagline, tagX + padX + dotR * 2 + gap, tagY + 5, {
        characterSpacing: 1,
      });

    // ---- Invoice To / Invoice No & Date — one shadowed info card ----
    const billLines = [
      c.phone && `P : ${c.phone}`,
      c.email && `E : ${c.email}`,
      (c.address || c.district || c.city) &&
        `A : ${[c.address, c.district, c.city].filter(Boolean).join(", ")}`,
    ].filter(Boolean);
    const infoRowCount = 2 + (includeCoupon ? 1 : 0);
    const leftBlockH = 16 + 16 + billLines.length * 13;
    const rightBlockH = infoRowCount * 15 + 24; // + status pill
    const panelTop = 175;
    const panelH = Math.max(leftBlockH, rightBlockH) + 40;

    drawCard(doc, CX, panelTop, CW, panelH, 10);
    doc.rect(CX, panelTop, 4, panelH).fill(BRAND);

    let y = panelTop + 20;
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .text("INVOICE TO", CX + 22, y, { characterSpacing: 0.5 });
    y += 16;
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(INK)
      .text(c.name || "-", CX + 22, y);
    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    billLines.forEach((line) => {
      doc.text(line, CX + 22, y, { width: 260 });
      y += 13;
    });

    const RX = PAGE_W - CX - 220;
    let ry = panelTop + 20;
    const infoRow = (label, value) => {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(label, RX, ry);
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(INK)
        .text(value, RX + 75, ry, { width: 145, align: "right" });
      ry += 15;
    };
    infoRow("Invoice No :", order.orderNumber);
    infoRow(
      "Date :",
      new Date(order.orderDate || order.createdAt).toLocaleDateString()
    );
    if (includeCoupon) {
      infoRow("Coupon Code :", c.customerCode || "-");
    }
    ry += 6;
    const pillW = 76;
    doc.roundedRect(RX + 220 - pillW, ry, pillW, 18, 9).fill(statusColor.bg);
    doc
      .fillColor(statusColor.text)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(order.paymentStatus, RX + 220 - pillW, ry + 6, {
        width: pillW,
        align: "center",
        characterSpacing: 0.5,
      });

    y = panelTop + panelH + 25;

    // ---- Items table: flat brand header + zebra-striped rows ----
    const cols = {
      sl: CX,
      item: CX + 45,
      price: CX + CW - 190,
      qty: CX + CW - 110,
      total: CX + CW - 70,
    };
    doc.rect(CX, y, CW, 28).fill(BRAND);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
    doc.text("SL", cols.sl + 12, y + 10);
    doc.text("ITEM DESCRIPTION", cols.item, y + 10, {
      characterSpacing: 0.3,
    });
    doc.text("PRICE", cols.price, y + 10, { width: 60, align: "right" });
    doc.text("QTY", cols.qty, y + 10, { width: 30, align: "right" });
    doc.text("TOTAL", cols.total, y + 10, {
      width: CX + CW - cols.total,
      align: "right",
    });
    y += 28;

    // Each order item is one physical unit (quantity always 1 on the
    // record) — group by product + unit price so the invoice reads
    // naturally when someone bought more than one of the same watch.
    const grouped = new Map();
    for (const it of order.items) {
      const key = `${it.productName}__${it.unitPrice}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: it.productName,
          unitPrice: it.unitPrice,
          qty: 0,
        });
      }
      grouped.get(key).qty += it.quantity || 1;
    }

    let sl = 1;
    const rowH = 28;
    for (const { name, unitPrice, qty } of grouped.values()) {
      if (y + rowH > 660) {
        doc.addPage();
        drawWatermark(doc);
        y = 50;
      }
      if (sl % 2 === 0) {
        doc.rect(CX, y, CW, rowH).fill(BRAND_LIGHT);
      }
      doc.font("Helvetica").fontSize(9).fillColor(INK);
      doc.text(String(sl).padStart(2, "0"), cols.sl + 12, y + 10);
      doc.text(name, cols.item, y + 10, { width: cols.price - cols.item - 10 });
      doc.text(money(unitPrice), cols.price, y + 10, {
        width: 60,
        align: "right",
      });
      doc.text(String(qty), cols.qty, y + 10, { width: 30, align: "right" });
      doc.text(money(unitPrice * qty), cols.total, y + 10, {
        width: CX + CW - cols.total,
        align: "right",
      });
      doc
        .moveTo(CX, y + rowH)
        .lineTo(CX + CW, y + rowH)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
      y += rowH;
      sl++;
    }

    // ---- Totals: shadowed card + colored callout bar for the grand total ----
    y += 22;
    const cardW = 250;
    const cardX = CX + CW - cardW;
    const rowsH = 3 * 18;
    const cardH = rowsH + 24;
    drawCard(doc, cardX, y, cardW, cardH, 10);

    let ty = y + 16;
    const labelX = cardX + 20;
    const valueW = cardW - 40;
    const totalRow = (label, value) => {
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(MUTED)
        .text(label, labelX, ty);
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(INK)
        .text(value, labelX, ty, { width: valueW, align: "right" });
      ty += 18;
    };
    totalRow("Sub Total", money(order.subtotal));
    totalRow("Discount", `- ${money(order.discount)}`);
    totalRow("Delivery", `+ ${money(order.deliveryCharge)}`);

    const barY = y + cardH + 10;
    doc.roundedRect(cardX, barY, cardW, 34, 10).fill(BRAND);
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Grand Total", labelX, barY + 11);
    doc.fontSize(13).text(money(order.totalAmount), labelX, barY + 11, {
      width: valueW,
      align: "right",
    });

    let py = barY + 34 + 14;
    const paidDueRow = (label, value, dotColor) => {
      doc.circle(labelX + 3, py + 5, 3).fill(dotColor);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(MUTED)
        .text(label, labelX + 14, py);
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(INK)
        .text(value, labelX, py, { width: valueW, align: "right" });
      py += 16;
    };
    paidDueRow("Paid", money(order.paidAmount), "#16a34a");
    paidDueRow(
      "Due",
      money(order.dueAmount),
      order.dueAmount > 0 ? "#dc2626" : "#16a34a"
    );

    // ---- Footer: diagonal brand banner with circle accents + accent strip ----
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(MUTED)
      .text("Thank you for shopping with Cozy Yards!", CX, PAGE_H - 165, {
        width: CW - 260,
      });

    const footerH = 140;
    const footPts = [
      [PAGE_W, PAGE_H],
      [PAGE_W - 350, PAGE_H],
      [PAGE_W - 250, PAGE_H - footerH],
      [PAGE_W, PAGE_H - footerH],
    ];
    doc.save();
    doc.polygon(...footPts).fill(BRAND);
    doc.restore();
    doc.save();
    doc.polygon(...footPts).clip();
    withAlpha(doc, 0.08, () => {
      doc.circle(PAGE_W - 60, PAGE_H - 120, 60).fill("#ffffff");
      doc.circle(PAGE_W - 300, PAGE_H - 20, 40).fill("#ffffff");
    });
    doc.restore();

    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Get in Touch", PAGE_W - 260, PAGE_H - footerH + 28, {
        width: 220,
        align: "right",
      });
    doc.font("Helvetica").fontSize(9.5);
    let fy = PAGE_H - footerH + 52;
    ["01798982335", "01309083807", "cozyyards.com"].forEach((line) => {
      doc.text(line, PAGE_W - 260, fy, { width: 220, align: "right" });
      fy += 16;
    });

    doc.rect(0, PAGE_H - 8, PAGE_W, 8).fill(BRAND_DARK);

    doc.end();
  } catch (err) {
    next(err);
  }
});

// Create order: reserves inventory items (Rule 1, 2, 4)
router.post("/", async (req, res, next) => {
  try {
    const {
      customer,
      items,
      discount = 0,
      deliveryCharge = 0,
      notes = "",
    } = req.body;
    if (!customer || !items || !items.length) {
      return res
        .status(400)
        .json({ message: "Customer and at least one item are required" });
    }

    const orderItems = [];
    let subtotal = 0;

    for (const it of items) {
      if (it.quantity < 1)
        return res.status(400).json({ message: "Quantity must be at least 1" });
      const product = await Product.findById(it.product);
      if (!product)
        return res
          .status(404)
          .json({ message: `Product not found: ${it.product}` });

      // Reserve available IN_STOCK inventory items for this product
      const available = await InventoryItem.find({
        product: product._id,
        status: "IN_STOCK",
      }).limit(it.quantity);
      if (available.length < it.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.watchName}. Available: ${available.length}, requested: ${it.quantity}`,
        });
      }

      const unitPrice =
        it.unitPrice ?? product.estSellingMin ?? product.purchasePrice;
      const costPrice = product.purchasePrice;
      const additionalCost = product.additionalCost;
      const profitEach = unitPrice - costPrice - additionalCost;

      for (const invItem of available) {
        invItem.status = "RESERVED";
        await invItem.save();
        await InventoryMovement.create({
          inventoryItem: invItem._id,
          product: product._id,
          type: "SALE",
          quantity: -1,
          notes: "Reserved for order",
        });
        orderItems.push({
          product: product._id,
          inventoryItem: invItem._id,
          productName: product.watchName,
          quantity: 1,
          unitPrice,
          costPrice,
          additionalCost,
          profit: profitEach,
        });
      }
      subtotal += unitPrice * it.quantity;

      const count = await InventoryItem.countDocuments({
        product: product._id,
        status: "IN_STOCK",
      });
      await Product.findByIdAndUpdate(product._id, { quantity: count });
    }

    const totalAmount = subtotal - Number(discount) + Number(deliveryCharge);
    const orderNumber = await generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      customer,
      items: orderItems,
      subtotal,
      discount,
      deliveryCharge,
      totalAmount,
      paidAmount: 0,
      dueAmount: totalAmount,
      paymentStatus: "UNPAID",
      status: "PENDING",
      deliveryStatus: "PENDING",
      notes,
      createdBy: req.user._id,
    });

    // link inventory items to this order
    await InventoryItem.updateMany(
      { _id: { $in: orderItems.map((o) => o.inventoryItem) } },
      { $set: { order: order._id } }
    );

    await Delivery.create({
      order: order._id,
      customer,
      deliveryCharge,
      status: "PENDING",
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const { discount, deliveryCharge, notes, status } = req.body;
    if (discount !== undefined) order.discount = discount;
    if (deliveryCharge !== undefined) order.deliveryCharge = deliveryCharge;
    if (notes !== undefined) order.notes = notes;

    order.totalAmount = order.subtotal - order.discount + order.deliveryCharge;
    order.dueAmount = order.totalAmount - order.paidAmount;
    order.paymentStatus = computePaymentStatus(
      order.totalAmount,
      order.paidAmount
    );

    if (status) {
      order.status = status;
      // Rule 6: cancelled orders release reserved inventory back to stock
      if (status === "CANCELLED") {
        const invIds = order.items.map((i) => i.inventoryItem).filter(Boolean);
        await InventoryItem.updateMany(
          { _id: { $in: invIds }, status: { $ne: "SOLD" } },
          { $set: { status: "IN_STOCK", order: null } }
        );
        for (const it of order.items) {
          const count = await InventoryItem.countDocuments({
            product: it.product,
            status: "IN_STOCK",
          });
          await Product.findByIdAndUpdate(it.product, { quantity: count });
        }
        // A cancelled order shouldn't keep contributing an outstanding "due"
        // amount to revenue/due reporting elsewhere — there's nothing left to
        // collect on it. Paid/total amounts are kept as-is for the record.
        order.dueAmount = 0;
      }
      if (status === "DELIVERED") {
        const invIds = order.items.map((i) => i.inventoryItem).filter(Boolean);
        await InventoryItem.updateMany(
          { _id: { $in: invIds } },
          { $set: { status: "SOLD", soldDate: new Date() } }
        );
        order.deliveryStatus = "DELIVERED";
        await Delivery.findOneAndUpdate(
          { order: order._id },
          { status: "DELIVERED", deliveredDate: new Date() }
        );
      }
    }

    await order.save();
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// Permanently delete an order. Any inventory items reserved for it that
// haven't already been sold are released back to IN_STOCK first (same as
// cancellation), then the order and its delivery record are removed.
router.delete("/:id", async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const invIds = order.items.map((i) => i.inventoryItem).filter(Boolean);
    await InventoryItem.updateMany(
      { _id: { $in: invIds }, status: { $ne: "SOLD" } },
      { $set: { status: "IN_STOCK", order: null } }
    );
    for (const it of order.items) {
      const count = await InventoryItem.countDocuments({
        product: it.product,
        status: "IN_STOCK",
      });
      await Product.findByIdAndUpdate(it.product, { quantity: count });
    }

    await Delivery.deleteOne({ order: order._id });
    await Order.findByIdAndDelete(req.params.id);

    res.json({ message: "Order deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
