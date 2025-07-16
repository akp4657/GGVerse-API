import nodemailer from 'nodemailer';
//require('dotenv').config();

export const sendVerificationEmail = async (email, token) => {
    try {
    // Create a fresh test account on every call
    const testAccount = await nodemailer.createTestAccount();

    const transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
        user: testAccount.user,
        pass: testAccount.pass,
        },
    });

    const verificationUrl = `http://localhost:8081/VerifyEmail?token=${token}`;

    const mailOptions = {
        from: `"No Reply" <${testAccount.user}>`,  // Use test account email as sender
        to: email,
        subject: 'Verify your email',
        html: `<p>Click the link to verify your email:</p><a href="${verificationUrl}">${verificationUrl}</a>`,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log('Mail sent');
    console.log('Preview URL:', nodemailer.getTestMessageUrl(info));  // <-- IMPORTANT! Check this URL to view the email

    } catch (err) {
    console.error('Error sending mail:', err);
    }
};