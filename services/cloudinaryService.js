import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Validate image file
export const validateImageFile = (file) => {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file size (max 5MB)
  const maxSize = 5 * 1024 * 1024; // 5MB in bytes
  if (file.size > maxSize) {
    return { valid: false, error: 'File size exceeds 5MB limit' };
  }

  // Check file type
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return { valid: false, error: 'Invalid file type. Allowed types: jpg, jpeg, png, webp, gif' };
  }

  return { valid: true };
};

// Upload avatar to Cloudinary
export const uploadAvatar = async (file, userId) => {
  try {
    // Validate file
    const validation = validateImageFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Upload to Cloudinary with transformations
    const uploadResult = await cloudinary.uploader.upload(file.path, {
      folder: 'avatars',
      public_id: `user_${userId}_${Date.now()}`,
      transformation: [
        { width: 1000, height: 1000, crop: 'limit' }, // Max 1000x1000, maintain aspect ratio
        { quality: 'auto', fetch_format: 'auto' }, // Auto optimize format and quality
      ],
      overwrite: false, // Don't overwrite existing files
      resource_type: 'image',
    });

    // Clean up temporary file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    return {
      success: true,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
    };
  } catch (error) {
    // Clean up temporary file on error
    if (file && file.path && fs.existsSync(file.path)) {
      try {
        fs.unlinkSync(file.path);
      } catch (unlinkError) {
        console.error('Error deleting temporary file:', unlinkError);
      }
    }

    throw error;
  }
};

// Delete avatar from Cloudinary
export const deleteAvatar = async (cloudinaryUrl) => {
  try {
    if (!cloudinaryUrl) {
      return { success: true, message: 'No avatar to delete' };
    }

    // Extract public_id from Cloudinary URL
    // Format: https://res.cloudinary.com/{cloud_name}/image/upload/{public_id}.{format}
    const urlParts = cloudinaryUrl.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    
    if (uploadIndex === -1 || uploadIndex === urlParts.length - 1) {
      // Not a Cloudinary URL, nothing to delete
      return { success: true, message: 'Not a Cloudinary URL, skipping deletion' };
    }

    // Get public_id from URL (everything after 'upload/')
    const publicIdWithVersion = urlParts.slice(uploadIndex + 1).join('/');
    // Remove file extension and version prefix if present
    const publicId = publicIdWithVersion.replace(/^v\d+\//, '').replace(/\.[^.]+$/, '');

    // Delete from Cloudinary
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });

    return {
      success: result.result === 'ok',
      message: result.result === 'ok' ? 'Avatar deleted successfully' : 'Avatar deletion failed',
    };
  } catch (error) {
    console.error('Error deleting avatar from Cloudinary:', error);
    // Don't throw error - deletion failure shouldn't break the flow
    return { success: false, message: error.message };
  }
};

// Extract public_id from Cloudinary URL (helper function)
export const extractPublicId = (cloudinaryUrl) => {
  if (!cloudinaryUrl) return null;
  
  try {
    const urlParts = cloudinaryUrl.split('/');
    const uploadIndex = urlParts.indexOf('upload');
    
    if (uploadIndex === -1 || uploadIndex === urlParts.length - 1) {
      return null;
    }

    const publicIdWithVersion = urlParts.slice(uploadIndex + 1).join('/');
    return publicIdWithVersion.replace(/^v\d+\//, '').replace(/\.[^.]+$/, '');
  } catch (error) {
    return null;
  }
};

