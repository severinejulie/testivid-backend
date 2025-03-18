-- Create Company Table
CREATE TABLE IF NOT EXISTS company (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create User Table
CREATE TABLE IF NOT EXISTS "user" (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    google_id TEXT UNIQUE,
    company_id UUID REFERENCES company(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create Question Table
CREATE TABLE IF NOT EXISTS question (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES company(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create Testimonial Table
CREATE TABLE IF NOT EXISTS testimonial (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES company(id) ON DELETE CASCADE,
    customer_email TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    video_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create Testimonial Responses Table
CREATE TABLE IF NOT EXISTS testimonial_responses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    testimonial_id UUID REFERENCES testimonial(id) ON DELETE CASCADE,
    question_id UUID REFERENCES question(id) ON DELETE CASCADE,
    video_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
