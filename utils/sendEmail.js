const nodemailer = require("nodemailer");

const sendEmail = async (email, name, username, password) => {
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "🎉 Account Approved — Your Credentials Inside",
    html: `
      <h2>Hi ${name},</h2>
      <p>Your account has been approved. Here are your login credentials:</p>
      <ul>
        <li><strong>Username:</strong> ${username}</li>
        <li><strong>Password:</strong> ${password}</li>
      </ul>
      <p>You can now login to your dashboard. 🎊</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
