// jobs/reminderScheduler.js
const cron = require('node-cron');
const supabase = require('../config/supabase');
const { sendReminderEmail } = require('../services/mailgun');

/**
 * Find pending testimonials that need reminders and send them
 */
const sendScheduledReminders = async () => {
  try {
    console.log('Running scheduled reminder check:', new Date().toISOString());
    
    // Get configuration
    const reminderIntervalDays = process.env.REMINDER_INTERVAL_DAYS || 7; // Default: send reminders weekly
    const maxReminders = process.env.MAX_REMINDERS || 3; // Default: max 3 reminders per testimonial
    
    // Calculate the date threshold for reminders
    const reminderThreshold = new Date();
    reminderThreshold.setDate(reminderThreshold.getDate() - reminderIntervalDays);
    
    // Find testimonials that need reminders
    const { data: testimonials, error } = await supabase
      .from('testimonial')
      .select(`
        *,
        company:company_id(name)
      `)
      .eq('status', 'pending')
      .lt('reminder_count', maxReminders)
      .or(`last_reminder_sent.is.null,last_reminder_sent.lt.${reminderThreshold.toISOString()}`);
    
    if (error) {
      console.error('Error fetching testimonials for reminders:', error);
      return;
    }
    
    console.log(`Found ${testimonials.length} testimonials needing reminders`);
    
    // Process each testimonial
    for (const testimonial of testimonials) {
      try {
        const reminderCount = (testimonial.reminder_count || 0) + 1;
        
        // Generate submission URL
        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const submissionUrl = `${baseUrl}/testimonial/submit/${testimonial.access_token}`;
        
        // Send reminder email
        const emailResult = await sendReminderEmail({
          to: testimonial.customer_email,
          customerName: 'Valued Customer', // We might not have the name stored
          companyName: testimonial.company.name,
          submissionUrl,
          reminderCount
        });
        
        if (!emailResult.success) {
          console.error(`Failed to send reminder for testimonial ${testimonial.id}:`, emailResult.error);
          continue;
        }
        
        // Record email history
        const { error: emailHistoryError } = await supabase
          .from('email_history')
          .insert({
            testimonial_id: testimonial.id,
            email_type: 'reminder',
            sent_at: new Date().toISOString(),
            status: 'sent',
            email_id: emailResult.messageId
          });
        
        if (emailHistoryError) {
          console.error('Error recording email history:', emailHistoryError);
        }
        
        // Update testimonial
        const { error: updateError } = await supabase
          .from('testimonial')
          .update({
            last_reminder_sent: new Date().toISOString(),
            reminder_count: reminderCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', testimonial.id);
        
        if (updateError) {
          console.error(`Error updating testimonial ${testimonial.id}:`, updateError);
        } else {
          console.log(`Sent reminder #${reminderCount} for testimonial ${testimonial.id}`);
        }
      } catch (err) {
        console.error(`Error processing reminder for testimonial ${testimonial.id}:`, err);
      }
    }
    
    console.log('Completed scheduled reminder processing');
  } catch (error) {
    console.error('Error in reminder scheduler:', error);
  }
};

/**
 * Check for expired testimonials and mark them as expired
 */
const markExpiredTestimonials = async () => {
  try {
    console.log('Checking for expired testimonials:', new Date().toISOString());
    
    const now = new Date().toISOString();
    
    // Find and update expired testimonials
    const { data, error } = await supabase
      .from('testimonial')
      .update({
        status: 'expired',
        updated_at: now
      })
      .eq('status', 'pending')
      .lt('expires_at', now);
    
    if (error) {
      console.error('Error marking expired testimonials:', error);
    } else {
      console.log(`Marked ${data?.length || 0} testimonials as expired`);
    }
  } catch (error) {
    console.error('Error checking expired testimonials:', error);
  }
};

/**
 * Initialize scheduled jobs
 */
const initScheduledJobs = () => {
  // Schedule reminder emails (daily at 9 AM)
  cron.schedule('0 9 * * *', sendScheduledReminders);
  
  // Schedule expiration check (daily at midnight)
  cron.schedule('0 0 * * *', markExpiredTestimonials);
  
  console.log('Testimonial reminder scheduler initialized');
};

module.exports = {
  initScheduledJobs,
  sendScheduledReminders, // Exported for manual triggering or testing
  markExpiredTestimonials
};