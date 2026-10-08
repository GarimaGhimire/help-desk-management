-- Migration 000006: Add staff_admin role to user_role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'staff_admin';
