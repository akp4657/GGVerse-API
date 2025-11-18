export const extractClientIP = (req, res, next) => {
  req.clientIP = 
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    req.connection?.remoteAddress ||
    req.ip ||
    null;
  
  next();
};

