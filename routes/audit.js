const express = require("express");
const AuditLog = require("../models/AuditLog");
const { protect, permit } = require("../middleware/auth");

const router = express.Router();

// SUPER_ADMIN is always allowed by permit(); ADMIN is added here.
router.use(protect, permit("ADMIN"));

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /audit?entity=PRODUCT|AUTH&action=UPDATE&search=rolex&from=2026-10-01&to=2026-10-17&page=1&limit=30
router.get("/", async (req, res, next) => {
  try {
    const { entity, action, search, from, to } = req.query;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const q = {};
    if (entity) q.entity = entity;
    if (action) q.action = action;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      q.$or = [{ userName: rx }, { userEmail: rx }, { entityLabel: rx }];
    }
    if (from || to) {
      q.createdAt = {};
      if (from) q.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        q.createdAt.$lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(q),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
