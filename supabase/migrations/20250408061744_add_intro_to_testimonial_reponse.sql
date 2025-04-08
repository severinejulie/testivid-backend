-- Migration to add intro_generated column to testimonial_responses table

-- Using SQL for PostgreSQL/Supabase

-- Add intro_generated column with default value of false
ALTER TABLE testimonial_responses ADD COLUMN intro_generated BOOLEAN DEFAULT FALSE;

-- Update existing records to set intro_generated to false
UPDATE testimonial_responses SET intro_generated = FALSE WHERE intro_generated IS NULL;

-- Make the column NOT NULL after updating existing records
ALTER TABLE testimonial_responses ALTER COLUMN intro_generated SET NOT NULL;