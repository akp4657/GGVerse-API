import geoip from 'geoip-lite';

export const geofence = (req, res, next) => {
  const clientIP = req.clientIP;
  
  if (!clientIP) {
    return res.status(400).send({ error: 'Unable to determine client IP' });
  }

  const geo = geoip.lookup(clientIP);
  const country = geo?.country || 'Unknown';
  const region = geo?.region || 'Unknown';
  const city = geo?.city || 'Unknown';
  
  //console.log('Geofence check - IP:', clientIP, '| Country:', country, '| Region:', region, '| City:', city);
  const regionBlacklist = [
    // COMMENTING OLDER LIST
    // 'AL',
    // 'AK',
    // 'AZ',
    // 'CA',
    // 'GA',
    // 'HI',
    // 'ID',
    // 'LA',
    // 'MN',
    // 'MS',
    // 'MT',
    // 'NM',
    // 'ND',
    // //'NY', // Test only
    // 'OK',
    // 'SC',
    // 'SD',
    // 'TN',
    // 'TX',
    // // 'UT' 

    'AZ',
    'AR',
    'DE',
    'LA',
    'SD',
    'VT'
  ];
  
  if (regionBlacklist.includes(region)) {
    return res.status(403).send({ error: 'Access denied - Region: ' + region });
  }
  
  next();
};

