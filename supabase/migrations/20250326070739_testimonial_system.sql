-- migrations/testimonial_system.sql

-- Email history table to track all sent emails
CREATE TABLE IF NOT EXISTS email_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  testimonial_id UUID NOT NULL REFERENCES testimonial(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL CHECK (email_type IN ('initial', 'reminder')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'failed')),
  email_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add additional fields to testimonial table
ALTER TABLE testimonial 
ADD COLUMN IF NOT EXISTS access_token UUID DEFAULT uuid_generate_v4() UNIQUE,
ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reminder_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled'));

-- Create index for faster lookup by access token
CREATE INDEX IF NOT EXISTS testimonial_access_token_idx ON testimonial(access_token);

-- Create index for faster lookup of pending testimonials
CREATE INDEX IF NOT EXISTS testimonial_status_idx ON testimonial(status);

-- Create index for reminder queries
CREATE INDEX IF NOT EXISTS testimonial_reminder_idx ON testimonial(last_reminder_sent) 
WHERE status = 'pending';

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to testimonial table
DROP TRIGGER IF EXISTS update_testimonial_updated_at ON testimonial;
CREATE TRIGGER update_testimonial_updated_at
BEFORE UPDATE ON testimonial
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to testimonial_responses table
DROP TRIGGER IF EXISTS update_testimonial_responses_updated_at ON testimonial_responses;
CREATE TRIGGER update_testimonial_responses_updated_at
BEFORE UPDATE ON testimonial_responses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to email_history table
DROP TRIGGER IF EXISTS update_email_history_updated_at ON email_history;
CREATE TRIGGER update_email_history_updated_at
BEFORE UPDATE ON email_history
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();