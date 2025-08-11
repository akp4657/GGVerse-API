import * as badgeService from '../services/badgeService.js';

// Create a new badge
export const createBadge = badgeService.createBadge;

// Get all badges
export const getAllBadges = badgeService.getAllBadges;

// Get badge by ID
export const getBadgeById = badgeService.getBadgeById;

// Update badge
export const updateBadge = badgeService.updateBadge;

// Delete badge
export const deleteBadge = badgeService.deleteBadge;

// Earn a badge
export const earnBadge = badgeService.earnBadge;