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
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">Welcome to GGVerse!</h2>
      <p>Hi ${username},</p>
      <p>Thank you for signing up! Please verify your email address by clicking the link below:</p>
      <p style="margin: 30px 0;">
        <a href="${verificationUrl}" 
           style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Verify Email Address
        </a>
      </p>
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
      <p style="color: #666; font-size: 14px; margin-top: 30px;">
        This link will expire in 24 hours.<br>
        If you didn't create an account, you can ignore this email.
      </p>
    </div>
  `,
  text: `Hi ${username},\n\nThank you for signing up for GGVerse! Please verify your email address by visiting this link:\n\n${verificationUrl}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account, you can ignore this email.`
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
    console.log(`Email sent successfully to ${to}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

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