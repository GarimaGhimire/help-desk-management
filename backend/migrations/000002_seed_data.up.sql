INSERT INTO users (id, name, email, phone, role, language_pref) VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Admin User', 'admin@fintara.com', '+977-9841000001', 'superadmin', 'en'),
    ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'Ram Shrestha', 'ram@fintara.com', '+977-9841000002', 'employee', 'ne'),
    ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'Sita Thapa', 'sita@fintara.com', '+977-9841000003', 'employee', 'en'),
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Hari Maharjan', 'hari@fintara.com', '+977-9841000004', 'employee', 'ne');

INSERT INTO groups (id, name, type, created_by) VALUES
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'General Support', 'internal', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'Nepal Investment Bank', 'bank', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

INSERT INTO group_members (group_id, user_id, role_in_group) VALUES
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin'),
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'member'),
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'member'),
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'admin'),
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'member');

INSERT INTO messages (group_id, sender_id, content) VALUES
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Welcome to the help desk system!'),
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'धन्यवाद! System राम्रो छ।'),
    ('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'Bank integration is ready for testing.');