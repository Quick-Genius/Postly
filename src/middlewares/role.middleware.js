'use strict';

const prisma = require('../config/prisma');

/**
 * Ensures the authenticated user has one of the required roles.
 * Must be used AFTER requireAuth.
 */
function requireRole(allowedRoles = []) {
  return async (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { role: true }
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      }

      req.userRole = user.role;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireRole };
