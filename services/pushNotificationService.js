import axios from 'axios';

/**
 * Send push notification using Expo's push notification service
 * @param {string} expoPushToken - The Expo push token (e.g., "ExponentPushToken[xxxxx]")
 * @param {string} title - Notification title
 * @param {string} body - Notification body/message
 * @param {object} data - Additional data to send with notification
 * @returns {Promise<object>} Response from Expo API
 */
export const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
  if (!expoPushToken) {
    console.log('No push token provided, skipping notification');
    return null;
  }

  const message = {
    to: expoPushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'default',
  };

  try {
    const response = await axios.post('https://exp.host/--/api/v2/push/send', message, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });

    const result = response.data;
    
    // Check if notification was sent successfully
    if (result.data && result.data.status === 'ok') {
      console.log('Push notification sent successfully:', result);
      return { success: true, result };
    } else {
      console.error('Failed to send push notification:', result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Error sending push notification:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send push notification to multiple tokens
 * @param {string[]} expoPushTokens - Array of Expo push tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body/message
 * @param {object} data - Additional data to send with notification
 * @returns {Promise<object>} Response from Expo API
 */
export const sendPushNotificationToMultiple = async (expoPushTokens, title, body, data = {}) => {
  if (!expoPushTokens || expoPushTokens.length === 0) {
    console.log('No push tokens provided, skipping notification');
    return null;
  }

  // Filter out null/undefined tokens
  const validTokens = expoPushTokens.filter(token => token);

  if (validTokens.length === 0) {
    console.log('No valid push tokens provided');
    return null;
  }

  const messages = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title: title,
    body: body,
    data: data,
    priority: 'high',
    channelId: 'default',
  }));

  try {
    const response = await axios.post('https://exp.host/--/api/v2/push/send', messages, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });

    const result = response.data;
    console.log('Push notifications sent to multiple devices:', result);
    return { success: true, result };
  } catch (error) {
    console.error('Error sending push notifications to multiple devices:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send challenge notification to challenged user
 * @param {string} pushToken - Expo push token
 * @param {string} challengerUsername - Username of the challenger
 * @param {object} challengeData - Challenge data (id, game, wager)
 * @returns {Promise<object>}
 */
export const sendChallengeNotification = async (pushToken, challengerUsername, challengeData) => {
  return await sendPushNotification(
    pushToken,
    'New Challenge! 🎯',
    `${challengerUsername} has challenged you to a match!`,
    {
      type: 'challenge',
      challengeId: challengeData.id?.toString() || challengeData.challengeId?.toString(),
      challengerId: challengeData.challengerId?.toString(),
      game: challengeData.game,
      wager: challengeData.wager?.toString(),
    }
  );
};

/**
 * Send challenge accepted notification to challenger
 * @param {string} pushToken - Expo push token
 * @param {string} challengedUsername - Username of the challenged user
 * @param {object} challengeData - Challenge data (id)
 * @returns {Promise<object>}
 */
export const sendChallengeAcceptedNotification = async (pushToken, challengedUsername, challengeData) => {
  return await sendPushNotification(
    pushToken,
    'Challenge Accepted! ✅',
    `${challengedUsername} has accepted your challenge!`,
    {
      type: 'challenge_accepted',
      challengeId: challengeData.id?.toString() || challengeData.challengeId?.toString(),
      challengedId: challengeData.challengedId?.toString(),
    }
  );
};

/**
 * Send challenge declined notification to challenger
 * @param {string} pushToken - Expo push token
 * @param {string} challengedUsername - Username of the challenged user
 * @param {object} challengeData - Challenge data (id)
 * @returns {Promise<object>}
 */
export const sendChallengeDeclinedNotification = async (pushToken, challengedUsername, challengeData) => {
  return await sendPushNotification(
    pushToken,
    'Challenge Declined',
    `${challengedUsername} has declined your challenge.`,
    {
      type: 'challenge_declined',
      challengeId: challengeData.id?.toString() || challengeData.challengeId?.toString(),
      challengedId: challengeData.challengedId?.toString(),
    }
  );
};

