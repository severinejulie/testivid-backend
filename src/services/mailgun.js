// services/mailgun.js
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);

const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY
});

const DOMAIN = process.env.MAILGUN_DOMAIN;

/**
 * Send a testimonial request email
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.customerName - Customer name
 * @param {string} options.companyName - Your company name
 * @param {string} options.submissionUrl - URL for testimonial form
 * @returns {Promise} - Mailgun response
 */

const sendTestTestimonialRequest = async (options) => {
  const nodemailer = require('nodemailer');
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "severinejulie@gmail.com",  
        pass: "vmjg ydlz cfud ifdi" 
      }
    });

    const htmlContent = `
      <p>Hi ${options.customerName},</p>
      <p>${options.companyName} would love your feedback!</p>
      <p>Please click the link below to record your testimonial:</p>
      <p><a href="${options.submissionUrl}" target="_blank">Record Your Testimonial</a></p>
      <p>Thanks,<br>${options.senderName || "The Team"}</p>
    `;

    const info = await transporter.sendMail({
      from: `"Testivid" <severinejulie@gmail.com>`,
      to: options.to,
      subject: options.subject || `${options.companyName} would like your feedback`,
      html: htmlContent,
    });

    console.log("Email sent:", info.messageId);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("Nodemailer error:", error);
    return { success: false, error: error.message };
  }
}

const sendTestimonialRequest = async (options) => {
  try {
    const data = {
      from: `${options.companyName} <testimonials@${DOMAIN}>`,
      to: options.to,
      subject: options.subject || `${options.companyName} would like your feedback`,
      template: "testimonial_request",
      'h:X-Mailgun-Variables': JSON.stringify({
        customerName: options.customerName,
        companyName: options.companyName,
        submissionUrl: options.submissionUrl,
        senderName: options.senderName || 'The Team'
      })
    };

    const response = await mg.messages.create(DOMAIN, data);
    return { success: true, messageId: response.id };
  } catch (error) {
    console.error('Mailgun error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send a reminder email for pending testimonial
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.customerName - Customer name
 * @param {string} options.companyName - Your company name
 * @param {string} options.submissionUrl - URL for testimonial form
 * @param {number} options.reminderCount - Which reminder this is
 * @returns {Promise} - Mailgun response
 */
const sendReminderEmail = async (options) => {
  try {
    const data = {
      from: `${options.companyName} <testimonials@${DOMAIN}>`,
      to: options.to,
      subject: options.subject || `Reminder: ${options.companyName} would appreciate your feedback`,
      template: "testimonial_reminder",
      'h:X-Mailgun-Variables': JSON.stringify({
        customerName: options.customerName,
        companyName: options.companyName,
        submissionUrl: options.submissionUrl,
        reminderCount: options.reminderCount,
        senderName: options.senderName || 'The Team'
      })
    };

    const response = await mg.messages.create(DOMAIN, data);
    return { success: true, messageId: response.id };
  } catch (error) {
    console.error('Mailgun error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Handle Mailgun webhook events
 * @param {Object} event - Mailgun webhook event
 * @returns {Promise} - Response
 */
const handleMailgunEvent = async (event) => {
  try {
    // Process different event types (delivered, opened, clicked, etc.)
    const { event: eventType, messageId, recipient } = event;
    
    // Return event data for processing
    return {
      success: true,
      eventType,
      messageId,
      recipient,
      timestamp: new Date()
    };
  } catch (error) {
    console.error('Error processing Mailgun event:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendTestimonialRequest,
  sendReminderEmail,
  handleMailgunEvent,
  sendTestTestimonialRequest
};