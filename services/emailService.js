import nodemailer from 'nodemailer';

// Simple SendGrid configuration
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@ggverse.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'GGVerse';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8081';

// Create SendGrid transporter
const createTransporter = () => {
  if (!SENDGRID_API_KEY) {
    throw new Error('SENDGRID_API_KEY environment variable is required');
  }

  return nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
      user: 'apikey',
      pass: SENDGRID_API_KEY,
    },
  });
};

// Simple email template
const createVerificationEmail = (verificationUrl, username = 'User') => ({
  subject: 'Verify Your Email - GGVerse',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A1626; color: #FFFFFF;">
      <h2 style="color: #7CFF4C; margin-bottom: 20px;">Welcome to GGVerse!</h2>
      <p style="color: #FFFFFF; font-size: 16px; line-height: 1.5;">Hi ${username},</p>
      <p style="color: #B3B3B3; font-size: 16px; line-height: 1.5;">Thank you for signing up! Please verify your email address by clicking the link below:</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" 
           style="background: #7CFF4C; color: #0A1626; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(124, 255, 76, 0.3);">
          Verify Email Address
        </a>
      </div>
      
      <div style="background: #14213D; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7CFF4C;">
        <p style="color: #B3B3B3; font-size: 14px; margin: 0 0 10px 0;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #7CFF4C; background: #0A1626; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 13px; margin: 0;">${verificationUrl}</p>
      </div>
      
      <p style="color: #555555; font-size: 14px; margin-top: 30px; text-align: center;">
        This link will expire in 24 hours.<br>
        If you didn't create an account, you can ignore this email.
      </p>
      
      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #1A2233;">
        <p style="color: #7CFF4C; font-size: 18px; font-weight: bold; margin: 0;">GGVerse</p>
        <p style="color: #555555; font-size: 12px; margin: 5px 0 0 0;">Where Gamers Compete</p>
      </div>
    </div>
  `,
  text: `Hi ${username},\n\nThank you for signing up for GGVerse! Please verify your email address by visiting this link:\n\n${verificationUrl}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account, you can ignore this email.\n\n---\nGGVerse - Where Gamers Compete`
});

// Main email sending function
const sendEmail = async (to, subject, html, text) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: to,
      subject: subject,
      html: html,
      text: text,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// Discord invite email template
const createDiscordInviteEmail = (inviteUrl, username = 'User') => ({
  subject: 'Join GGVerse Discord Server - Complete Your Setup',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A1626; color: #FFFFFF;">
      <h2 style="color: #7CFF4C; margin-bottom: 20px;">🎮 Welcome to GGVerse!</h2>
      <p style="color: #FFFFFF; font-size: 16px; line-height: 1.5;">Hi ${username},</p>
      <p style="color: #B3B3B3; font-size: 16px; line-height: 1.5;">You've successfully linked your Discord account! To start playing and connect with other players, you <strong style="color: #7CFF4C;">need to join our Discord server</strong>.</p>
      
      <div style="background: #14213D; padding: 25px; border-radius: 12px; margin: 25px 0; text-align: center; border: 1px solid #1A2233;">
        <h3 style="color: #7CFF4C; margin-top: 0; font-size: 20px;">Join Our Discord Server</h3>
        <p style="margin: 15px 0; color: #B3B3B3; font-size: 16px;">Click the button below to join and start playing:</p>
        <a href="${inviteUrl}" 
           style="background: #7CFF4C; color: #0A1626; padding: 15px 35px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(124, 255, 76, 0.3);">
          Join Discord Server
        </a>
      </div>
      
      <div style="background: #1A2233; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="color: #7CFF4C; font-weight: bold; font-size: 16px; margin-top: 0;">What you can do once you join:</p>
        <ul style="color: #B3B3B3; font-size: 15px; line-height: 1.6; padding-left: 20px;">
          <li style="margin-bottom: 8px;">Participate in challenges with other players</li>
          <li style="margin-bottom: 8px;">Find opponents for your favorite games</li>
          <li style="margin-bottom: 8px;">Connect with the GGVerse community</li>
          <li style="margin-bottom: 8px;">Get notified about new features and events</li>
        </ul>
      </div>
      
      <div style="background: #14213D; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7CFF4C;">
        <p style="color: #B3B3B3; font-size: 14px; margin: 0 0 10px 0;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #7CFF4C; background: #0A1626; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 13px; margin: 0;">${inviteUrl}</p>
      </div>
      
      <p style="color: #555555; font-size: 14px; margin-top: 30px; text-align: center;">
        This invite link is single-use and will expire after use.<br>
        If you have any questions, feel free to reach out to our support team.
      </p>
      
      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #1A2233;">
        <p style="color: #7CFF4C; font-size: 18px; font-weight: bold; margin: 0;">GGVerse</p>
        <p style="color: #555555; font-size: 12px; margin: 5px 0 0 0;">Where Gamers Compete</p>
      </div>
    </div>
  `,
  text: `Hi ${username},\n\nYou've successfully linked your Discord account! To start playing and connect with other players, you need to join our Discord server.\n\nJoin here: ${inviteUrl}\n\nWhat you can do once you join:\n- Participate in challenges with other players\n- Find opponents for your favorite games\n- Connect with the GGVerse community\n- Get notified about new features and events\n\nThis invite link is single-use and will expire after use.\n\nIf you have any questions, feel free to reach out to our support team.\n\n---\nGGVerse - Where Gamers Compete`
});

// Public function for verification emails
export const sendVerificationEmail = async (email, token, username = null) => {
  const verificationUrl = `${BASE_URL}/VerifyEmail?token=${token}`;
  const emailTemplate = createVerificationEmail(verificationUrl, username);
  
  return await sendEmail(
    email, 
    emailTemplate.subject, 
    emailTemplate.html, 
    emailTemplate.text
  );
};

// Public function for Discord invite emails
export const sendDiscordInviteEmail = async (email, username, inviteUrl) => {
  const emailTemplate = createDiscordInviteEmail(inviteUrl, username);
  
  return await sendEmail(
    email, 
    emailTemplate.subject, 
    emailTemplate.html, 
    emailTemplate.text
  );
};