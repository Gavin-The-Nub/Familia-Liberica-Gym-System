-- Enum Types
CREATE TYPE membership_type AS ENUM ('1_day', 'weekly', 'monthly');
CREATE TYPE member_status AS ENUM ('active', 'suspended', 'cancelled', 'expired');

-- Members Table
CREATE TABLE public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL,
    email VARCHAR,
    photo_url VARCHAR,
    membership_type membership_type NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status member_status NOT NULL DEFAULT 'active',
    qr_code VARCHAR UNIQUE NOT NULL,
    payment_amount DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    pending_deletion BOOLEAN DEFAULT false,
    phone TEXT,
    category TEXT,
    membership_category TEXT
);

-- Attendance Table
CREATE TABLE public.attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    check_in_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(member_id, check_in_date)
);

-- Renewals Table
CREATE TABLE public.renewals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    membership_type membership_type NOT NULL,
    membership_category TEXT,
    previous_end_date DATE NOT NULL,
    new_end_date DATE NOT NULL,
    payment_amount DECIMAL(10, 2) NOT NULL,
    renewed_by VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_attendance_date ON public.attendance(check_in_date);
CREATE INDEX idx_attendance_member ON public.attendance(member_id);
CREATE INDEX idx_members_status ON public.members(status);
CREATE INDEX idx_members_end_date ON public.members(end_date);
CREATE INDEX idx_renewals_member ON public.renewals(member_id);
CREATE INDEX idx_renewals_created ON public.renewals(created_at);

-- Email / notification audit (e.g. expiry reminders; updated by app + provider webhooks)
CREATE TABLE public.member_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'expiry_reminder',
    recipient_email TEXT NOT NULL,
    subject TEXT,
    body_html TEXT,
    body_text TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'delivered', 'bounced', 'failed', 'skipped')),
    provider_message_id TEXT,
    error_message TEXT,
    delivered_at TIMESTAMPTZ,
    metadata JSONB
);

CREATE INDEX idx_member_notification_logs_member ON public.member_notification_logs(member_id);
CREATE INDEX idx_member_notification_logs_sent ON public.member_notification_logs(sent_at DESC);

-- RLS (Row Level Security) - allow anon access for MVP since there's no auth setup
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read/write access to members" ON public.members FOR ALL USING (true);
CREATE POLICY "Allow anon read/write access to attendance" ON public.attendance FOR ALL USING (true);
CREATE POLICY "Allow anon read/write access to renewals" ON public.renewals FOR ALL USING (true);
CREATE POLICY "Allow anon read/write access to member_notification_logs" ON public.member_notification_logs FOR ALL USING (true);

-- Staff portal roles (linked to Supabase Auth)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_profiles_role ON public.profiles(role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- New auth users default to staff; promote admins in SQL Editor:
-- UPDATE public.profiles SET role = 'admin' WHERE id = '<user-uuid>';
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'staff');
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_new_user();

-- App Settings (admin-configurable pricing)
CREATE TABLE public.app_settings (
    key TEXT PRIMARY KEY,
    value NUMERIC(10, 2) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read app settings"
    ON public.app_settings FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Allow admins to write app settings"
    ON public.app_settings FOR ALL
    USING (
      EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
      )
    );

INSERT INTO public.app_settings (key, value)
VALUES
  ('session_rate', 70.00),
  ('weekly_rate', 200.00),
  ('monthly_rate', 600.00),
  ('student_rate', 500.00)
ON CONFLICT (key) DO NOTHING;

-- POS System Schema
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL,
    category VARCHAR,
    price DECIMAL(10, 2) NOT NULL,
    stock_count INTEGER DEFAULT 0,
    total_sold INTEGER NOT NULL DEFAULT 0,
    image_url VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL DEFAULT 1,
    total_price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read/write access to products" ON public.products FOR ALL USING (true);
CREATE POLICY "Allow anon read/write access to sales" ON public.sales FOR ALL USING (true);

-- Sale Trigger for Stock Decrement
CREATE OR REPLACE FUNCTION public.handle_sale_stock()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.products
    SET 
        stock_count = CASE WHEN stock_count IS NOT NULL THEN stock_count - NEW.quantity ELSE NULL END,
        total_sold = total_sold + NEW.quantity
    WHERE id = NEW.product_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_sale_created ON public.sales;
CREATE TRIGGER on_sale_created
    AFTER INSERT ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_sale_stock();