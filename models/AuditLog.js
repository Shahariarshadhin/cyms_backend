const mongoose = require("mongoose");

/**
 * One row per tracked event (product create/update/delete, logins).
 * User details are copied into the row ("snapshot") so the history still
 * reads correctly even if that user is later renamed or deleted.
 */
const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userName: { type: String, default: "" },
    userEmail: { type: String, default: "" },
    userRole: { type: String, default: "" },

    action: {
      type: String,
      required: true,
      enum: [
        "LOGIN",
        "LOGIN_FAILED",
        "CREATE",
        "UPDATE",
        "DELETE",
        "DEACTIVATE",
      ],
    },
    entity: { type: String, default: "PRODUCT" }, // PRODUCT | AUTH
    entityId: { type: String, default: "" },
    entityLabel: { type: String, default: "" }, // e.g. "Rolex Submariner (WP-0012)"

    // For UPDATE: [{ field, from, to }]
    changes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    note: { type: String, default: "" },

    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entity: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
