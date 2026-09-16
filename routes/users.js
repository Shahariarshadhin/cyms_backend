const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { protect, permit } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SALES", "INVENTORY_MANAGER", "ACCOUNTS"];

// Only Super Admin manages users & roles. permit() with no extra roles
// still allows SUPER_ADMIN (see middleware/auth.js), and blocks everyone else.
router.use(permit());

router.get("/", async (req, res, next) => {
  try {
    const { search, role, status } = req.query;
    const q = {};
    if (search) {
      q.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }
    if (role) q.role = role;
    if (status === "active") q.isActive = true;
    if (status === "inactive") q.isActive = false;

    const users = await User.find(q).select("-password").sort({ createdAt: -1 });
    res.json({ users, roles: ROLES });
  } catch (err) {
    next(err);
  }
});

// Super Admin creates a user directly with a chosen role
router.post("/", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Missing fields" });
    if (role && !ROLES.includes(role)) return res.status(400).json({ message: "Invalid role" });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ message: "Email already registered" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
      role: role || "SALES",
    });

    const { password: _pw, ...safeUser } = user.toObject();
    res.status(201).json(safeUser);
  } catch (err) {
    next(err);
  }
});

// Update a user's role, active status, or name
router.put("/:id", async (req, res, next) => {
  try {
    const { name, role, isActive } = req.body;
    if (role && !ROLES.includes(role)) return res.status(400).json({ message: "Invalid role" });

    if (req.params.id === String(req.user._id) && (role || isActive === false)) {
      return res.status(400).json({ message: "You cannot change your own role or deactivate yourself" });
    }

    const update = {};
    if (name !== undefined) update.name = name;
    if (role !== undefined) update.role = role;
    if (isActive !== undefined) update.isActive = isActive;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// Reset a user's password (Super Admin action)
router.put("/:id/password", async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(req.params.id, { password: hashed }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Password updated" });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (req.params.id === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "SUPER_ADMIN") {
      const superAdminCount = await User.countDocuments({ role: "SUPER_ADMIN" });
      if (superAdminCount <= 1) {
        return res.status(400).json({ message: "Cannot delete the last Super Admin" });
      }
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;