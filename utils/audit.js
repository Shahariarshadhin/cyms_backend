const AuditLog = require("../models/AuditLog");

function clientInfo(req) {
  const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    ip: forwarded || req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300),
  };
}

/**
 * Record an event. Never throws: a failed audit write must not break the
 * request the person actually made.
 *
 * logAudit(req, {
 *   user,          // user document (defaults to req.user)
 *   userEmail,     // only needed when there is no user (failed login)
 *   action, entity, entityId, entityLabel, changes, note
 * })
 */
async function logAudit(req, data) {
  try {
    const user = data.user || req.user || null;
    await AuditLog.create({
      user: user?._id,
      userName: user?.name || "",
      userEmail: user?.email || data.userEmail || "",
      userRole: user?.role || "",
      action: data.action,
      entity: data.entity || "PRODUCT",
      entityId: data.entityId ? String(data.entityId) : "",
      entityLabel: data.entityLabel || "",
      changes: data.changes || [],
      note: data.note || "",
      ...clientInfo(req),
    });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
}

/**
 * Compare two plain objects over a list of fields and return only the ones
 * that actually changed: [{ field, from, to }]
 */
function diffFields(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = before[field] ?? "";
    const to = after[field] ?? "";
    if (String(from) !== String(to)) changes.push({ field, from, to });
  }
  return changes;
}

module.exports = { logAudit, diffFields };
