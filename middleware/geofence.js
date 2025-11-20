import geoip from 'geoip-lite';

export const geofence = (req, res, next) => {
  const clientIP = req.clientIP;
  
  if (!clientIP) {
    return res.status(400).send({ error: 'Unable to determine client IP' });
  }

  const geo = geoip.lookup('98.10.249.53');
  console.log(geo);
  const country = geo?.country || 'Unknown';
  const region = geo?.region || 'Unknown';
  const city = geo?.city || 'Unknown';
  
  //console.log('Geofence check - IP:', clientIP, '| Country:', country, '| Region:', region, '| City:', city);
  const regionBlacklist = [
    'AL',
    'AK',
    'CA',
    'GA',
    'HI',
    'ID',
    'MN',
    'MS',
    'NM',
    'ND',
    //'NY', // Test only
    'OK',
    'SC',
    'SD',
    'TX',
    'UT' 
  ];
  
  if (regionBlacklist.includes(region)) {
    return res.status(403).send({ error: 'Access denied - Region: ' + region });
  }
  
  next();
};

