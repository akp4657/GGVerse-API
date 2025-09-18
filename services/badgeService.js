import prisma from '../prisma/prisma.js';

// Create a new badge
export const createBadge = async (req, res) => {
  try {
    const { name, description, icon, color } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).send({ error: 'Badge name is required' });
    }

    // Check if badge with same name already exists
    const existingBadge = await prisma.Lookup_Badge.findFirst({
      where: { Name: name }
    });

    if (existingBadge) {
      return res.status(400).send({ error: 'Badge with this name already exists' });
    }

    // Create new badge
    const badge = await prisma.Lookup_Badge.create({
      data: {
        Name: name,
        Description: description || null,
        Icon: icon || null,
        Color: color || null
      }
    });

    res.status(201).send({
      success: true,
      message: 'Badge created successfully',
      badge: {
        id: badge.id,
        name: badge.Name,
        description: badge.Description,
        icon: badge.Icon,
        color: badge.Color
      }
    });
  } catch (error) {
    console.error('Create badge error:', error);
    res.status(500).send({ error: 'Failed to create badge' });
  }
};

// Get all badges
export const getAllBadges = async (req, res) => {
  try {
    const badges = await prisma.Lookup_Badge.findMany({
      orderBy: { id: 'asc' }
    });

    const formattedBadges = badges.map(badge => ({
      id: badge.id,
      name: badge.Name,
      description: badge.Description,
      icon: badge.Icon,
      color: badge.Color
    }));

    res.status(200).send({
      success: true,
      count: badges.length,
      badges: formattedBadges
    });
  } catch (error) {
    console.error('Get all badges error:', error);
    res.status(500).send({ error: 'Failed to retrieve badges' });
  }
};

// Get badge by ID(s) - supports both single ID and multiple IDs
export const getBadgeById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if it's a comma-separated list of IDs
    if (id.includes(',')) {
      const badgeIds = id.split(',').map(idStr => parseInt(idStr.trim()));
      
      // Validate all IDs are numbers
      if (badgeIds.some(id => isNaN(id))) {
        return res.status(400).send({ error: 'Invalid badge ID format' });
      }

      const badges = await prisma.Lookup_Badge.findMany({
        where: {
          id: {
            in: badgeIds
          }
        },
        orderBy: { id: 'asc' }
      });

      // Check if all requested badges were found
      const foundIds = badges.map(badge => badge.id);
      const missingIds = badgeIds.filter(id => !foundIds.includes(id));

      const formattedBadges = badges.map(badge => ({
        id: badge.id,
        name: badge.Name,
        description: badge.Description,
        icon: badge.Icon,
        color: badge.Color
      }));

      res.json({
        success: true,
        requestedIds: badgeIds,
        foundCount: badges.length,
        missingIds: missingIds,
        badges: formattedBadges
      });
    } else {
      // Single ID handling - return as array for consistency
      const badgeId = parseInt(id);

      if (isNaN(badgeId)) {
        return res.status(400).send({ error: 'Invalid badge ID' });
      }

      const badge = await prisma.Lookup_Badge.findUnique({
        where: { id: badgeId }
      });

      if (!badge) {
        return res.status(404).send({ error: 'Badge not found' });
      }

      const formattedBadge = {
        id: badge.id,
        name: badge.Name,
        description: badge.Description,
        icon: badge.Icon,
        color: badge.Color
      };

      res.json({
        success: true,
        requestedIds: [badgeId],
        foundCount: 1,
        missingIds: [],
        badges: [formattedBadge]
      });
    }
  } catch (error) {
    console.error('Get badge by ID error:', error);
    res.status(500).send({ error: 'Failed to retrieve badge(s)' });
  }
};

// Update badge
export const updateBadge = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, color } = req.body;
    const badgeId = parseInt(id);

    if (isNaN(badgeId)) {
      return res.status(400).send({ error: 'Invalid badge ID' });
    }

    // Check if badge exists
    const existingBadge = await prisma.Lookup_Badge.findUnique({
      where: { id: badgeId }
    });

    if (!existingBadge) {
      return res.status(404).send({ error: 'Badge not found' });
    }

    // Check if new name conflicts with existing badge (excluding current badge)
    if (name && name !== existingBadge.Name) {
      const nameConflict = await prisma.Lookup_Badge.findFirst({
        where: {
          Name: name,
          id: { not: badgeId }
        }
      });

      if (nameConflict) {
        return res.status(400).send({ error: 'Badge with this name already exists' });
      }
    }

    // Update badge
    const updatedBadge = await prisma.Lookup_Badge.update({
      where: { id: badgeId },
      data: {
        Name: name !== undefined ? name : existingBadge.Name,
        Description: description !== undefined ? description : existingBadge.Description,
        Icon: icon !== undefined ? icon : existingBadge.Icon,
        Color: color !== undefined ? color : existingBadge.Color
      }
    });

    res.json({
      success: true,
      message: 'Badge updated successfully',
      badge: {
        id: updatedBadge.id,
        name: updatedBadge.Name,
        description: updatedBadge.Description,
        icon: updatedBadge.Icon,
        color: updatedBadge.Color
      }
    });
  } catch (error) {
    console.error('Update badge error:', error);
    res.status(500).send({ error: 'Failed to update badge' });
  }
};

// Delete badge
export const deleteBadge = async (req, res) => {
  try {
    const { id } = req.params;
    const badgeId = parseInt(id);

    if (isNaN(badgeId)) {
      return res.status(400).send({ error: 'Invalid badge ID' });
    }

    // Check if badge exists
    const existingBadge = await prisma.Lookup_Badge.findUnique({
      where: { id: badgeId }
    });

    if (!existingBadge) {
      return res.status(404).send({ error: 'Badge not found' });
    }

    // Check if badge is being used by any users
    const usersWithBadge = await prisma.Users.findMany({
      where: {
        Badges: {
          has: badgeId
        }
      }
    });

    if (usersWithBadge.length > 0) {
      return res.status(400).send({ 
        error: 'Cannot delete badge. It is currently assigned to users.',
        usersCount: usersWithBadge.length
      });
    }

    // Delete badge
    await prisma.Lookup_Badge.delete({
      where: { id: badgeId }
    });

    res.status(200).send({
      success: true,
      message: 'Badge deleted successfully'
    });
  } catch (error) {
    console.error('Delete badge error:', error);
    res.status(500).send({ error: 'Failed to delete badge' });
  }
};

// Earn a badge (add badge to user's badge collection)
export const earnBadge = async (req, res) => {
  try {
    const { userId, badgeId } = req.body;

    // Validate required fields
    if (!userId || !badgeId) {
      return res.status(400).send({ error: 'User ID and Badge ID are required' });
    }

    const userIdInt = parseInt(userId);
    const badgeIdInt = parseInt(badgeId);

    if (isNaN(userIdInt) || isNaN(badgeIdInt)) {
      return res.status(400).send({ error: 'Invalid User ID or Badge ID' });
    }

    // Check if user exists
    const user = await prisma.Users.findUnique({
      where: { id: userIdInt }
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    // Check if badge exists
    const badge = await prisma.Lookup_Badge.findUnique({
      where: { id: badgeIdInt }
    });

    if (!badge) {
      return res.status(404).send({ error: 'Badge not found' });
    }

    // Check if user already has this badge
    if (user.Badges && user.Badges.includes(badgeIdInt)) {
      return res.status(400).send({ 
        error: 'User already has this badge',
        badge: {
          id: badge.id,
          name: badge.Name,
          description: badge.Description,
          icon: badge.Icon,
          color: badge.Color
        }
      });
    }

    // Add badge to user's badge collection
    const updatedUser = await prisma.Users.update({
      where: { id: userIdInt },
      data: {
        Badges: {
          push: badgeIdInt
        }
      }
    });

    res.status(200).send({
      success: true,
      message: 'Badge earned successfully',
      user: {
        id: updatedUser.id,
        username: updatedUser.Username,
        badges: updatedUser.Badges
      },
      badge: {
        id: badge.id,
        name: badge.Name,
        description: badge.Description,
        icon: badge.Icon,
        color: badge.Color
      }
    });
  } catch (error) {
    console.error('Earn badge error:', error);
    res.status(500).send({ error: 'Failed to earn badge' });
  }
};